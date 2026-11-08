# Sum Duel: master reference

> Living architecture reference. Update this **before every push or major change**. If code and this file disagree, that is a bug.

Live: **https://sumduel.app** (`www.sumduel.app` 308-redirects to the apex; `sumduel.vercel.app` also serves it). Vercel project `sumduel`, team `james-projects-f6199c2a`. Repo: `github.com/intox-duck/sumduel`, branch `main`.

---

## ACTIVE TASK / session handoff (updated 2026-11-08)

- **Situation:** v2.2 replaces the v2.1 Google-sign-in admin portal (which was never switched on) with **roles stored in Neon**. It also adds a full **activity log**, an **mIRC-style chat** with safeguarding filters, a **flag review queue** and **daily automated safeguarding audits**. The owner is giving the site to their 9-year-old daughter as a gift. The owner is a hidden **super admin**. The daughter will be an **admin** (mostly a player, plus moderation and password resets), and her actions are visible to the owner.
- **Roles now:** `james.s.king@gmail.com` (user id 7) = `super_admin`, set with `npm run role` on 2026-11-08. **The daughter's account doesn't exist yet.** Once she signs up, the owner promotes her in `/admin` → Players → role dropdown → Admin (or with `npm run role -- <her email> admin`).
- **Why not Google sign-in any more:** the owner judged OAuth client setup "too hardcore" for a family app and asked for super admin mapped from the database. The risk this reopens: player sign-up has no email confirmation. It's mitigated because the super_admin role sits on the **existing account row (id 7)**, which the owner already created on 2026-11-08 09:01 UTC, not on an email string. Nobody can re-register that email. The account is protected by its password plus the 10-failures-per-15-minutes lockout. Advise the owner to use a strong password.
- **Done this session (v2.1 → v2.2):** domain bought and attached; retro mathlib redesign; v2.1 admin portal replaced by v2.2 roles; activity log; chat; audits. `CRON_SECRET` set on Vercel (sensitive, production + preview). Migrations applied (`npm run migrate`, 24 statements, which drop the empty v2.1 `admin_sessions`/`admin_audit` tables).
- **QA:** 61/61 end-to-end checks (`qa/test2.mjs` in the session scratchpad). They cover:
  - 404s for signed-out users and players;
  - role masking (an admin sees the super_admin as "player"; `/api/auth` never reveals super_admin);
  - admins can't reset super or admin passwords or change roles;
  - the chat filter: email, phone and links blocked; maths and sumduel.app allowed; profanity masked; grooming phrases flagged;
  - `/me`, the rate limit, reports, soft deletes and their propagation, mutes, generic error wording when muting the super_admin;
  - flags with context, review;
  - activity rows for sign-up, sign-in, battles, scores, chat and admin actions;
  - manual audit, cron 401/200.

  Screenshots in headless Chromium: chat as a player (desktop/paper) and as an admin (phone/blackboard), and the portal as admin and super admin. Test data was cleaned up afterwards. Only user id 7 remains, and `audit_reports` is empty.
- **Unused leftover:** the `ADMIN_EMAILS` env var on Vercel (from v2.1) is no longer read by any code. It's harmless and can be deleted in the Vercel dashboard (there's no MCP delete tool).
- **Next ideas (not built):** email or push alerts when a wellbeing or personal-info flag fires (needs an email provider such as Resend, plus an API key in env); online duels; friend codes; achievements; server-side Daily verification.
- **Gotchas:**
  - Vercel CLI: run `vercel whoami` first (it hangs on device login). Prefer the Vercel MCP tools.
  - `pkill -f <pattern>` inside a Bash tool call kills its own shell. Kill by PID.
  - The local WSL clock runs about 3 s behind Neon. **Any time window compared with `activity_log.at` must use the DB `now()`** (`_audit.js` does).
  - Emails are lowercased on sign-up. Match them lowercased in SQL (`npm run role` does).
  - The Write tool can turn ` ` escapes into literal characters, which breaks JS regexes. Build such lines with escaped sequences through Python (done for `_safety.js`).
  - GitHub release downloads returned 504 here; raw.githubusercontent worked. jsDelivr refuses repos over 50 MB.

---

## 1. Architecture & module layout

A static single-page app plus six Vercel serverless functions (Hobby limit 12). There's **no build step** and no framework.

| Path | Role |
|---|---|
| `index.html` | Markup for every view plus **all CSS inline**. Preloads three fonts. Loads `app.js` (defer). |
| `app.js` | The whole player client: router, games, auth, sync, record, boards, **chat**, sound, confetti. ES5-style IIFE. |
| `admin.html` + `admin-portal.js` | The admin portal at `/admin` (clean URL). Inline CSS, no inline JS (strict CSP). Shows a plain 404 page to anyone who isn't an admin. |
| `sw.js` | Service worker `sd-v2.1.0`: precaches the shell and fonts; navigations network-first with **only `/` cached**; never caches `/api/*` or `/admin*`. Bump `VERSION` when shell files change. |
| `fonts/` | Self-hosted woff2 subsets and their licences (`fonts/README.md`). |
| `api/_lib.js` | Neon client, `route()`, scrypt, player sessions (`currentUser` returns `role`, `muted_until`), `publicUser`, `isMod`/`isSuper`, **`logEvent()`**. |
| `api/_safety.js` | Chat safeguarding filter (`screen()`). |
| `api/_audit.js` | `runAudit(req, actor, trigger)`: builds and stores a safeguarding report. |
| `api/auth.js` | Player auth (`enter`, `logout`, `rename`). Logs sign_up, sign_in, sign_in_failed, sign_in_locked, sign_out and rename. |
| `api/battles.js` | Own battles GET; idempotent POST. Logs `battle_saved` with a compact summary. |
| `api/board.js` | Leaderboards. Logs `score_posted`. |
| `api/chat.js` | Chat (poll, send, report, delete, mute). Exports `CHANNELS`. |
| `api/admin.js` | Admin API (role-gated, see §7). |
| `api/audit-cron.js` | Vercel cron target. Checks `Authorization: Bearer $CRON_SECRET`, then calls `runAudit`. |
| `scripts/migrate.js` | Idempotent schema (`npm run migrate`). |
| `scripts/role.js` | `npm run role -- <email> <player|admin|super_admin>`. **The only way to create a super_admin.** Logs `role_set_cli`. |
| `vercel.json` | Clean URLs, `lhr1`, headers (strict CSP + noindex + no-store on `/admin*`, immutable `/fonts/*`), and `crons: [{ path: /api/audit-cron, schedule: "0 7 * * *" }]`. |

### Client views (hash router)
`#/` Arena · `#/duel`, `#/tol` setup · `#/record` · `#/boards` · **`#/chat`** · `#/account`. The game screens aren't routed. `route()` calls `chatStop()` on every navigation, so polling only runs while the chat view is open.

## 2. Code & data workflow

### Games, battle record shape, offline-first sync
Unchanged from v2. Duel, Truth or Lie, Sprint and Daily live in `app.js`. Battles are written to `sd_battles` + `sd_pending` and flushed in batches of 200, deduped on `(user_id, client_id)`. Guest battles migrate to the account on sign-in. Shape:
```js
{ cid, at, game: 'duel'|'tol'|'sprint'|'daily', mode?, cfg: { ops, level, n? }, winner?: 0|1|-1, day?, practice?,
  players: [{ name, time?, raw?, wrong, score?, splits?, bestStreak?, wrongBy?, avgRt? }] }   // account holder = player 0
```

### Player auth (explicit product decision: no email confirmation)
- One form: an unknown email creates the account, a known email signs in.
- scrypt; an HttpOnly + Secure + SameSite=Lax cookie `sd_s` valid 365 days, storing only the token's SHA-256.
- 10 failures per email+IP per 15 min → 429.
- `publicUser` adds `admin:true` **only** for the `admin` role (it drives the "Admin tools" button on the Account page). **super_admin is indistinguishable from a player in every player-facing response.**

### Activity log (`activity_log`, append-only, read only by super_admin)
`logEvent(req, actor, action, {target, detail})` stores the actor id, email and role, the action, the target id and email, `detail` jsonb, IP and user agent. It never throws.

| Group | Actions |
|---|---|
| Accounts | `sign_up`, `sign_in`, `sign_in_failed`, `sign_in_locked`, `sign_out`, `rename` |
| Games | `battle_saved` (summary: game, winner, opponent, times or scores), `score_posted` |
| Chat | `chat_message` (text, plus flags and the original if masked), `chat_blocked` (reason + the attempted text), `chat_report`, `chat_delete` (keeps the text), `chat_mute`, `chat_unmute` |
| Admin | `admin_open`, `admin_password_reset`, `admin_role_change`, `admin_review`, `audit_run`, `audit_reviewed`, `role_set_cli` |

There's no retention limit: everything is kept.

### Chat (`#/chat`, `api/chat.js`)
- **Channels:** `#lobby` and `#duels` (the `CHANNELS` map, with topics). Signed-in players only.
- **Transport:** polling (Vercel functions can't hold websockets). `GET /api/chat?c=&after=<id>` returns new messages, the ids removed in the last 3 min, and who's online (presence row upserted on each poll; online = seen within the last 40 s). The client polls every 3 s, backs off to 8 s after about a minute of quiet, pauses when the tab is hidden and stops when you leave the view. *Budget note:* Hobby allows about 1M function calls a month. 10 kids × 2 h a day ≈ 0.4–0.9M, so watch usage if the chat gets busy.
- **Sending:** muted users get 403. Rate limit: 5 messages per 10 s → 429. Maximum 300 characters. `/me` creates an action line. The client also handles `/help` and `/clear`.
- **Safeguarding filter (`_safety.js`):** it runs on a normalised copy (lowercase, leetspeak undone, repeated letters squashed).
  - **Blocked:** emails, phone numbers (9+ digits with separators) and links (sumduel.app is allowed). The attempt is logged as `chat_blocked` with its text.
  - **Masked and flagged `profanity`:** swear words and slurs.
  - **Flagged only (still posted):**
    - `personal_info`: grooming-risk phrases (age, address, school, "send a pic", snapchat, insta, whatsapp, tiktok, discord, "meet up", "keep it secret", "don't tell your parents", "are you alone", boyfriend/girlfriend…);
    - `wellbeing`: self-harm and "kys"-type words;
    - `unkind`: mild insults.
- **Moderation:** any player can **report** (sets `flagged`, adds `reported`, creates a `chat_reports` row). Admins and the super_admin can **soft-delete** (`deleted_at`; players see "[message removed by a moderator]"; the super_admin still sees the text) and **mute** for 10 min, 1 h, 1 day or 1 week, or unmute. Admins can only mute players; the super_admin is refused with the same "You can't mute this player." message used for admins.
- **Op display:** the nick list shows `@` for the `admin` role only. The super_admin looks like a regular player.

### Admin portal (`/admin`)
- `GET /api/admin` returns `{role, me}` for admin and super_admin. For everyone else, including signed-out visitors, the API returns **404** and the page shows a plain "Page not found", so the portal's existence isn't revealed.
- **Admin tabs:** **Players** (search; set password for players; mute) and **Chat** (recent messages in either channel incl. removed ones without text; delete; mute 1 h; mutes list with unmute).
- **Super admin tabs add:**
  - **Flags**: unreviewed flagged and reported messages, wellbeing and personal-info first, each with 5 lines of context and its reports. Actions: mark reviewed, remove + reviewed, mute 1 h or 1 day. The tab badge shows the count.
  - **Activity**: filter by group and search email, text or IP; 100 rows at a time with "Load older"; Export CSV.
  - **Audits**: list, "Run audit now", mark reviewed.
- **Super admin also gets:** a role dropdown (player ↔ admin; never super_admin), Details per player (scores, battles, chat messages incl. removed, activity), and the true roles in every list.
- **Password reset:** the admin sets or generates a password. This ends the target's sessions (except the caller's own) and clears `auth_fails`. Nothing is emailed.

### Safeguarding audits (`audit_reports`)
- **Triggers:** the Vercel cron runs daily at **07:00 UTC** (Hobby crons can drift up to about an hour), and the super_admin can run one on demand.
- **Window:** from the previous report's end to the DB's `now()`, capped at 7 days.
- **Contents:**
  - an attention list (unreviewed flags, open reports, blocked attempts, lockouts, wellbeing flags);
  - totals (new players, sign-ins, wrong passwords, lockouts, battles, scores, chat messages, blocked, flagged, reports, removed, mutes, password resets, role changes, flags waiting, open reports);
  - flag reasons; the top 5 chatters;
  - the last 20 blocked attempts with their text;
  - **every moderation and admin action by `admin`-role users** (oversight of the daughter's actions);
  - who is currently muted.

### Database (Neon Postgres, `lhr1`)
- **Core tables:**
  - `users(id, email unique, name, pw_hash, created_at, role ['player'|'admin'|'super_admin'], muted_until)`
  - `sessions(token_hash pk, user_id, created_at, expires_at)`
  - `battles(id, user_id, client_id, game, played_at, data jsonb)`
  - `scores(board, user_id pk, score, created_at)`
  - `auth_fails(key, at)`
- **v2.2 tables:**
  - `activity_log(id, at, actor_user_id, actor_email, actor_role, action, target_user_id, target_email, detail jsonb, ip, ua)`
  - `chat_messages(id, channel, user_id, nick, kind, body, at, flagged, flag_reason, deleted_at, deleted_by, reviewed_at, reviewed_by)`
  - `chat_reports(id, message_id, reporter_id, reason, at, resolved_at)`
  - `chat_presence(user_id, channel, seen_at)`
  - `audit_reports(id, created_at, trigger, period_start, period_end, data jsonb, reviewed_at, reviewed_by)`

## 3. Reasons for change
- **v1 → v2:** frictionless accounts, Neon (no free Upstash), side games, `e.code` keys, accessibility fixes.
- **v2.1 redesign:** the owner asked for a "retro mathlib aesthetic" (LaTeX paper), then a Lean-style monospace headline. The fonts are self-hosted Latin Modern + JuliaMono ("SD Lean Mono"). CMU was rejected because it lacks ×, −, ≤ and →.
- **v2.1 → v2.2 admin:** Google OAuth was dropped at the owner's request ("too hardcore"). Roles live in the DB. super_admin can only be set from the CLI, so no UI path can create or remove one. It's bound to an existing account row.
- **Hidden super admin:** the owner asked that their account look like a regular user until they type `/admin`. Hence: no `admin` flag in `/api/auth` for super_admin, no `@` in chat, role masked as "player" in admin views, and generic wording when admins try to act on it.
- **Admins can't touch admin or super accounts:** without that, the daughter (admin) could reset the owner's password and take over the super_admin account.
- **Chat safeguarding:** the users are children. Personal details and links are blocked outright; grooming and wellbeing signals are flagged for an adult instead of silently blocked, so context is kept. Nothing is hard-deleted.
- **Audit window on DB time:** QA found a 3 s drift between the function host and Neon, which dropped fresh events from audits.
- **v2.1 service worker fix:** only `/` is cached, so other pages can't overwrite the shell.

## 4. Styling & design system
- **Approach:** hand-written CSS inline in `index.html` and `admin.html` (shared tokens). No framework.
- **Themes:** `paper` (default) and `night` ("Blackboard mode", stored in localStorage `sumduel.theme`). Old `dark`/`light` values fall back to paper.
- **Paper tokens:** `--bg #F7F3E8`, `--surface #FBF8F1`, `--surface2 #F2EDE1`, `--ink #1A1A1A`, `--muted #4D4A42`, `--faint #77715F`, `--line rgba(26,26,26,.16)`, `--line2 rgba(26,26,26,.5)`, `--p1 #1D4E89`, `--p2 #9B1C31` (deep tints `#E3E9F1`/`#F3E2E1`), `--win #2D6A2E`, `--warn #8E5D07`, `--bad #C0262D`. `--p1-glow`/`--p2-glow` are `transparent`, which neutralises the glows `app.js` still writes inline.
- **Night tokens:** `--bg #1E2A24`, `--ink #EEEDE6`, `--p1 #9CC6EE`, `--p2 #F2A7B8`, `--win #B9DC97`, `--bad #FF8A80`.
- **Type:**
  - `--serif` "SD LM Roman" for prose;
  - `--caps` "SD LM Caps" (always lowercased → even small caps) for labels, buttons and nav;
  - `--mono` "SD Lean Mono" for headings, numbers, questions, keypad, equations, logo, kickers and chat.
  - `em` in mono headings is upright and coloured.
- **Motifs:**
  - Kickers are Lean comments (`-- §n`): §1 arena, §2 games, §3 numbers/record, §4 boards, **§5 chat**, **§6 account**, **§7 preferences**. Admin portal: §1 Players … §5 Audits, with headings in Lean type-signature style (`players : List User`).
  - "Definition 1.1" lede with a QED box; numbered equations; "Exercise n" cards; booktabs tables; "Figure n" captions; ballot-box toggles.
- **Chat window exception:** `.irc` deliberately uses **classic Win9x/mIRC chrome in both themes**:
  - grey `#C0C0C0` bevels; title bar gradient `#000080 → #1084D0`; white log;
  - mIRC nick colours from `NICKC`; system lines green `#009300`; actions purple `#9C009C`; errors `#FC0000`.
  - A decorative menu bar (hidden under 640 px), a channel switchbar, and a nick list (on phones a "Nicks (n)" toggle shows it under the log).
- **Shape:** radius 2 px (cards are square); 18 px gutter; max width 1080 px. Tab bar under 760 px with 5 tabs.
- **Motion:** wrong-answer shake + `--bad` wash; countdown; ink-coloured confetti; everything respects `prefers-reduced-motion`.
- **Do NOT:**
  - use `var()` in SVG presentation attributes;
  - add a framework or build step without reason;
  - re-add `user-scalable=no`;
  - use `.empty` except for the answer slot;
  - bring back glows or neon;
  - load Google Fonts (blocked by the admin CSP);
  - use the original font names for the subsets;
  - **expose the super_admin role in any player-facing or admin-facing response.**

## 5. Frameworks, libraries & tooling
- Runtime dependency: `@neondatabase/serverless@^1.2` (server only). Clients have zero dependencies.
- Node ≥ 20 (Vercel uses 26.x), ESM.
- **Fonts:** about 145 KB total, immutable cache. Built with fonttools `pyftsubset --flavor=woff2`. Ranges and sources are in `fonts/README.md` and the v2.1 notes: Latin Modern from CTAN; JuliaMono v0.63.2 renamed "SD Lean Mono".
- **npm scripts:** `migrate`, `role`.
- **Local QA (session scratchpad, not in the repo):**
  - `qa/server.mjs` mounts `api/*.js` (including `audit-cron` with `CRON_SECRET=test-cron-secret`) and serves static files.
  - `qa/test2.mjs` holds the 61 checks; it creates `qa.*.<tag>@example.com` users, sets roles via SQL, and cleans up after itself.
  - `qa/shots4.mjs` takes the screenshots.
  - `qa/cleanup2.mjs` deletes every `qa.%@example.com` user and its logs, plus **all** `audit_reports`, so don't run it once real audits exist.
  - Browser: `playwright-core@1.56.1` with the cached `chromium_headless_shell-1208`.

## 6. Deploy & environment
- **Hosting:** Vercel Hobby (card on file), project `prj_46A6caxkH7B2TjfcipANTRX3rqS4`, team `team_w10Hnku1fiDJkY4FcEBrB68v`. Functions run in `lhr1`. **Crons:** `/api/audit-cron` daily at 07:00 UTC.
- **Deploys:** pushes to `main` auto-deploy to production.
- **Domains:** `sumduel.app` (bought through Vercel on 2026-11-08, order `01M6WBKVNMN4DTFC872W79MK4W`, $9.99/yr, auto-renew on), `www` → 308, `sumduel.vercel.app`.
- **Env:**

  | Variable | Status |
  |---|---|
  | `DATABASE_URL` + `POSTGRES_*` / `PG*` | Injected by the Neon integration |
  | `CRON_SECRET` | Sensitive; production + preview |
  | `ADMIN_EMAILS` | Unused leftover, safe to delete |

  `.env.example` documents `DATABASE_URL` and `CRON_SECRET`. Locally: `vercel env pull .env.local` (gitignored). No secrets in the repo.
- **Schema:** edit `scripts/migrate.js`, then `npm run migrate`. **Roles:** `npm run role -- <email> <role>`.

## 7. Roles & permissions
| Role | Set by | Sees / can do |
|---|---|---|
| **player** | default on sign-up | Play; read and write own battles and name; post scores; chat (subject to the filter, rate limit and mutes); report messages. `/admin` shows 404. |
| **admin** (the daughter) | super_admin in Players → role, or `npm run role` | Everything a player can do, plus an "Admin tools" button on Account, `@` in chat, and the `/admin` Players and Chat tabs: search players, reset **players'** passwords, delete messages, mute or unmute **players**. Can't see the activity log, flags, audits or player details. Can't act on admin or super_admin accounts. Sees the super_admin as an ordinary player. Every action is logged and listed in each audit. |
| **super_admin** (the owner) | **only** `npm run role` (CLI) | Looks exactly like a player in the game and in chat. Types `/admin` while signed in to get everything: all players with true roles, role changes, password resets for anyone, mutes for anyone, removed-message text, the flag review queue, the full activity log with CSV export, audits (run, read, mark reviewed), and per-player histories. |
