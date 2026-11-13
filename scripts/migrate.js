// One-off / idempotent schema setup. Run: npm run migrate  (reads DATABASE_URL from .env.local)
import { neon } from '@neondatabase/serverless';
import { V28 } from '../api/_schema.js';

const url = process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL not set'); process.exit(1); }
const sql = neon(url);

const statements = [
  `create table if not exists users (
     id          bigserial primary key,
     email       text not null unique,
     name        text not null,
     pw_hash     text not null,
     created_at  timestamptz not null default now()
   )`,
  `create table if not exists sessions (
     token_hash  text primary key,
     user_id     bigint not null references users(id) on delete cascade,
     created_at  timestamptz not null default now(),
     expires_at  timestamptz not null
   )`,
  `create index if not exists sessions_user_idx on sessions(user_id)`,
  `create table if not exists battles (
     id          bigserial primary key,
     user_id     bigint not null references users(id) on delete cascade,
     client_id   text not null,
     game        text not null,
     played_at   timestamptz not null,
     data        jsonb not null,
     unique (user_id, client_id)
   )`,
  `create index if not exists battles_user_time_idx on battles(user_id, played_at desc)`,
  `create table if not exists scores (
     user_id     bigint not null references users(id) on delete cascade,
     board       text not null,
     score       double precision not null,
     created_at  timestamptz not null default now(),
     primary key (board, user_id)
   )`,
  `create index if not exists scores_board_score_idx on scores(board, score)`,
  `create table if not exists auth_fails (
     key         text not null,
     at          timestamptz not null default now()
   )`,
  `create index if not exists auth_fails_key_idx on auth_fails(key, at)`,
  // v2.2 roles: player | admin | super_admin (super_admin is only ever set via `npm run role`)
  `alter table users add column if not exists role text not null default 'player'`,
  `do $$ begin
     alter table users add constraint users_role_chk check (role in ('player','admin','super_admin'));
   exception when duplicate_object then null; end $$`,
  `alter table users add column if not exists muted_until timestamptz`,
  // v2.4: set after an admin reset or for a starter password; the player must pick their own before playing
  `alter table users add column if not exists must_change_pw boolean not null default false`,
  // Everything that happens on the site, append-only. Read only by super_admin.
  `create table if not exists activity_log (
     id              bigserial primary key,
     at              timestamptz not null default now(),
     actor_user_id   bigint,
     actor_email     text,
     actor_role      text,
     action          text not null,
     target_user_id  bigint,
     target_email    text,
     detail          jsonb,
     ip              text,
     ua              text
   )`,
  `create index if not exists activity_at_idx on activity_log(at desc)`,
  `create index if not exists activity_action_idx on activity_log(action, at desc)`,
  `create index if not exists activity_actor_idx on activity_log(actor_user_id, at desc)`,
  // Chat (mIRC-style). Messages are never hard-deleted: moderators soft-delete, super_admin still sees them.
  `create table if not exists chat_messages (
     id           bigserial primary key,
     channel      text not null,
     user_id      bigint not null references users(id) on delete cascade,
     nick         text not null,
     kind         text not null default 'msg',
     body         text not null,
     at           timestamptz not null default now(),
     flagged      boolean not null default false,
     flag_reason  text,
     deleted_at   timestamptz,
     deleted_by   bigint,
     reviewed_at  timestamptz,
     reviewed_by  bigint
   )`,
  `create index if not exists chat_channel_idx on chat_messages(channel, id)`,
  `create index if not exists chat_flagged_idx on chat_messages(id) where flagged and reviewed_at is null`,
  `create table if not exists chat_reports (
     id           bigserial primary key,
     message_id   bigint not null references chat_messages(id) on delete cascade,
     reporter_id  bigint not null references users(id) on delete cascade,
     reason       text,
     at           timestamptz not null default now(),
     resolved_at  timestamptz
   )`,
  `create table if not exists chat_presence (
     user_id  bigint not null references users(id) on delete cascade,
     channel  text not null,
     seen_at  timestamptz not null default now(),
     primary key (user_id, channel)
   )`,
  // Daily safeguarding audits (Vercel cron) + on-demand runs.
  `create table if not exists audit_reports (
     id            bigserial primary key,
     created_at    timestamptz not null default now(),
     trigger       text not null,
     period_start  timestamptz not null,
     period_end    timestamptz not null,
     data          jsonb not null,
     reviewed_at   timestamptz,
     reviewed_by   bigint
   )`,
  // v2.3 live games: two players on separate devices, polled. One row per game; the server owns timing.
  `create table if not exists live_games (
     id             bigserial primary key,
     code           text not null unique,
     name           text not null,
     host_id        bigint not null references users(id) on delete cascade,
     guest_id       bigint references users(id) on delete set null,
     invited_id     bigint,
     is_private     boolean not null default false,
     pass_hash      text,
     cfg            jsonb not null,
     status         text not null default 'open',
     host_ready     boolean not null default false,
     guest_ready    boolean not null default false,
     host_seen      timestamptz not null default now(),
     guest_seen     timestamptz,
     questions      jsonb,
     start_at       timestamptz,
     host_idx       int not null default 0,
     host_wrong     int not null default 0,
     host_done_at   timestamptz,
     host_raw       double precision,
     host_extra     jsonb,
     guest_idx      int not null default 0,
     guest_wrong    int not null default 0,
     guest_done_at  timestamptz,
     guest_raw      double precision,
     guest_extra    jsonb,
     result         jsonb,
     rematch_code   text,
     created_at     timestamptz not null default now(),
     updated_at     timestamptz not null default now()
   )`,
  `create index if not exists live_games_status_idx on live_games(status, created_at desc)`,
  `create index if not exists live_games_host_idx on live_games(host_id, status)`,
  `create index if not exists live_games_guest_idx on live_games(guest_id, status)`,
  // v2.1's Google-sign-in admin tables were never used in production (GOOGLE_CLIENT_ID was never set) and were empty.
  `drop table if exists admin_sessions`,
  `drop table if exists admin_audit`,
  // v2.8: wallets (coins, lives, the Climb, the daily gift) and Daily VS ghosts. Defined in api/_schema.js.
  // Apply before deploying v2.8: the functions no longer create tables themselves.
  ...V28,
];

for (const s of statements) await sql.query(s);
console.log('Schema ready:', statements.length, 'statements applied');
