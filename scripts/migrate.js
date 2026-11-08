// One-off / idempotent schema setup. Run: npm run migrate  (reads DATABASE_URL from .env.local)
import { neon } from '@neondatabase/serverless';

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
  // Admin portal (/admin): separate sessions + an append-only audit trail.
  `create table if not exists admin_sessions (
     token_hash  text primary key,
     email       text not null,
     created_at  timestamptz not null default now(),
     expires_at  timestamptz not null
   )`,
  `create table if not exists admin_audit (
     id              bigserial primary key,
     admin_email     text not null,
     action          text not null,
     target_user_id  bigint,
     target_email    text,
     ip              text,
     at              timestamptz not null default now()
   )`,
  `create index if not exists admin_audit_at_idx on admin_audit(at desc)`,
];

for (const s of statements) await sql.query(s);
console.log('Schema ready:', statements.length, 'statements applied');
