// v2.8 schema: wallets (coins, lives, the Climb, daily gift) and Daily VS ghosts.
// scripts/migrate.js applies these too, but the functions that need them also call ensureSchema() once per
// cold start, so a deploy works even if nobody has run `npm run migrate` yet. Every statement is idempotent.
import { db } from './_lib.js';

export const V28 = [
  `create table if not exists wallets (
     user_id      bigint primary key references users(id) on delete cascade,
     coins        int not null default 200,
     lives        int not null default 5,
     lives_at     timestamptz not null default now(),
     climb_level  int not null default 1,
     climb_stars  jsonb not null default '{}'::jsonb,
     gift_day     text,
     gift_streak  int not null default 0,
     run          jsonb,
     earn_day     text,
     earn_n       int not null default 0,
     rev          int not null default 0,
     updated_at   timestamptz not null default now()
   )`,
  `create table if not exists daily_vs (
     day         text not null,
     user_id     bigint not null references users(id) on delete cascade,
     time        double precision not null,
     raw         double precision not null,
     wrong       int not null,
     splits      jsonb not null,
     rival       text,
     won         boolean,
     created_at  timestamptz not null default now(),
     primary key (day, user_id)
   )`,
  `create index if not exists daily_vs_day_time_idx on daily_vs(day, time)`,
];

let ready = null;
export function ensureSchema() {
  if (!ready) ready = (async () => { const sql = db(); for (const s of V28) await sql.query(s); })().catch(e => { ready = null; throw e; });
  return ready;
}
