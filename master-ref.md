# Sum Duel: master reference

> Living architecture reference. Update this **before every push or major change**. If code and this file disagree, that is a bug.

Live for now on the Vercel deployment URL: **https://sumduel-m85bddwyn-james-projects-f6199c2a.vercel.app** (deploy `dpl_7F9Q9B4c…`). Project aliases under `*.vercel.app` have not been verified. `sumduel.app` is NOT registered yet, see the handoff below. (Vercel project `sumduel`, team `james-projects-f6199c2a`). Repo: `github.com/intox-duck/sumduel`, branch `main`.

---

## ACTIVE TASK / session handoff (updated 2026-11-08)

- **BLOCKER (found 2026-11-08):** the `sumduel.app` purchase **failed**. Order `01M6W4V42EZK35YXQJ4WAPNGGB` has status `failed`, error `payment-failed`. The domain is still available (checked with `get_domain_availability`), DNS doesn't resolve, and `get_domain_config` reports `misconfigured: true`. Fix: update the payment method on the Vercel team, then buy it again (about $9.99/yr). Production deploy `dpl_7F9Q9B4cMwPYsYNPUdT8CcorQoVW` (commit `b96b5f7`) is READY on the `*.vercel.app` URL.

- **Situation:** v2 rebuild of the original single-file Sum Duel (from `sumduel.zip`) is complete. It adds accounts, battle history, leaderboards, two side games and a neon "consulting meets maths" redesign.
- **Done:** Neon Postgres `sumduel-db` (free plan, `lhr1`) provisioned and connected; schema applied with `npm run migrate`. The API was tested end to end with curl (16 checks) and the UI in headless Chromium at phone (390×844), tablet (820×1180) and desktop (1366×860), dark and light themes.
- **Next steps / ideas not built yet:** online (remote) duels over WebSockets or polling; friend codes so both players' records update; achievements and badges; an "Exhibit" PDF/PNG export of a season; better anti-cheat (server-side seeded verification of Daily answers).
- **Gotchas:**
  - The Vercel CLI hangs silently when it isn't logged in, because it runs a device-login flow. Run `vercel whoami` first.
  - `vercel link` is interactive. The project is already linked through `.vercel/project.json`, which is gitignored.
  - Upstash Redis on this team has **no free plan** (pay-as-you-go only), which is why the app uses Neon.
  - The test users created during QA have emails `test+…@example.com` / `ui.tester+…@example.com`. They're harmless and can be deleted.

---

## 1. Architecture & module layout

A static single-page app plus three Vercel serverless functions. There's **no build step** and no framework.

| Path | Role |
|---|---|
| `index.html` | Markup for every view, plus **all CSS inline** (critical path = one request). It loads `app.js` with `defer`. |
| `app.js` | The whole client: router, game engines, auth, sync, record, boards, sound, confetti. A single IIFE written in ES5-compatible style (no transpile needed for older Safari/Android). |
| `sw.js` | Service worker. Precaches the app shell, network-first for navigations, stale-while-revalidate for assets, cache-first for Google Fonts. It never caches `/api/*`. **Bump `VERSION` when shell files change.** |
| `manifest.webmanifest`, `icon.svg` | PWA install (Add to Home Screen), standalone portrait. |
| `api/_lib.js` | Shared server helpers: Neon client, `route()` wrapper, scrypt hashing, sessions/cookies, validation. The `_` prefix keeps Vercel from deploying it as a route. |
| `api/auth.js` | `GET` = current user. `POST` actions `enter` (sign in **or** create), `logout`, `rename`. |
| `api/battles.js` | `GET` = the user's battles (newest first, ≤1000). `POST` = idempotent batch insert keyed by client id. |
| `api/board.js` | Leaderboards: `sprint` (personal best, higher is better) and `daily:YYYY-MM-DD` (first attempt only, lower is better). |
| `scripts/migrate.js` | Idempotent schema creation (`npm run migrate`, which reads `.env.local`). |
| `vercel.json` | Clean URLs, functions pinned to `lhr1` (next to the DB), and security/cache headers. |

Legacy: the original v1 `index.html` lives only in `sumduel.zip` (gitignored). Nothing else is unused.

### Client views (hash router)
`#/` Arena (home) · `#/duel` and `#/tol` setup · `#/record` · `#/boards` · `#/account`. The game screens (`#play`, `#handoff`, `#results`) aren't routed. Any hash change aborts a running game (so the browser Back button acts as quit). While a game is running, `body.ingame` hides the header and tab bar.

## 2. Code & data workflow

### Games (all in `app.js`)
| Game | Players | Rules | Saved as |
|---|---|---|---|
| **Duel** | 2, split screen (P2 half rotated 180°) or take turns with a handoff screen | Same seeded questions for both, separate clocks, +3 s (`PENALTY`) per wrong answer, lowest total wins. An answer auto-submits once its digit count matches. | `game:'duel'` |
| **Truth or Lie** | 2, split screen | One shared equation, about 50% true. Lies are near misses (±1, ±2, ±10, ± one operand). The first correct call scores; a wrong call locks you out for the round; if both are wrong the round skips. First to 7 (`TOL_TARGET`) wins. | `game:'tol'` |
| **Sprint** | solo | 60 s, medium difficulty, all four operations. Score = number correct. Tracks streaks and wrong answers by operation. | `game:'sprint'` + board POST |
| **Daily** | solo | 20 questions seeded by `hashStr('sumduel-daily-'+UTC date)`, so everyone gets the same set. Time + penalties. A repeat on the same device is flagged `practice`. | `game:'daily'` + board POST (first attempt) |

The question generator `makeQuestions(n, ops, level, seed)` uses a mulberry32 PRNG. Subtraction and division are built backwards so every answer is a whole non-negative number. `RANGES` sets the difficulty bands.

**Input:** pointer events on the on-screen pads (`pointerdown`, `preventDefault` to kill delay and zoom). On a keyboard, `e.code` is mapped so `Digit*` goes to P1 and `Numpad*` goes to P2. This works with NumLock on or off, which `e.key` didn't. Backspace deletes and Esc clears. In Truth or Lie, P1 presses A/S and P2 presses K/L.

### Battle record shape (stored as JSONB, also in localStorage)
```js
{ cid, at: ISO, game: 'duel'|'tol'|'sprint'|'daily', mode?: 'split'|'turns',
  cfg: { ops, level, n? }, winner?: 0|1|-1, day?, practice?,
  players: [{ name, time?, raw?, wrong, score?, splits?: [sec…], bestStreak?, wrongBy?: {op:n}, avgRt? }] }
```
The account holder is always **player index 0 (P1)**. Stats treat `winner===0` as a win, and head-to-head rivals are grouped by P2 name (case-insensitive).

### Offline-first sync
1. `recordBattle()` writes to `sd_battles` (the local cache, newest first, max 1000) **and** `sd_pending` (the queue).
2. `flush()` POSTs pending battles in batches of 200 when signed in. The server dedupes on `(user_id, client_id)`, so retries are safe.
3. On sign-in, every guest battle on the device is queued, so it migrates into the account. A guest's unsent Daily time (`sd_daily_unsent`) is posted if it's still the same UTC day.
4. `pullBattles()` = flush, then GET, then merge with anything still pending.
5. Sign-out clears the local cache and queue (shared-device privacy).
6. `online` event = flush.

If the API is down, everything still works locally. The Boards view shows an offline message.

### Auth (by explicit product decision: **no email confirmation**)
- One form: email + password. An unknown email creates the account instantly; a known email signs in. The default display name is the email's local part (with any `+tag` dropped and `._-` turned into spaces), and you can edit it in Account.
- Passwords: `scrypt` (N=16384, r=8, p=1, 64-byte key, 16-byte salt), stored as `s1$salt$key`.
- Sessions: a random 32-byte token in an **HttpOnly, Secure, SameSite=Lax** cookie `sd_s`, valid 365 days. Only the SHA-256 of the token is stored (`sessions.token_hash`).
- Brute-force limit: 10 failed attempts per email+IP per 15 min returns 429 (`auth_fails` table, opportunistic cleanup).
- CSRF: SameSite=Lax plus JSON-only POSTs (`route()` returns 415 for non-JSON).

### Database (Neon Postgres, `lhr1`)
`users(id, email unique, name, pw_hash, created_at)` · `sessions(token_hash pk, user_id, created_at, expires_at)` · `battles(id, user_id, client_id, game, played_at, data jsonb, unique(user_id, client_id))` · `scores(board, user_id pk, score, created_at)` · `auth_fails(key, at)`. Driver: `@neondatabase/serverless` over HTTP (no connection pool needed in serverless).

### Leaderboard plausibility (not real anti-cheat)
Sprint must be an integer 0–150. A Daily time must be ≥ 7 s (20 × 0.35 s) and the Daily date must be today or yesterday (UTC). Daily keeps the first attempt only (`on conflict do nothing`); Sprint keeps the best.

## 3. Reasons for change (v1 → v2)
- **Accounts + record:** the user asked for very easy sign-up, with email + password as the account and no confirmation, plus tracking of every battle. A single "enter" endpoint means there's no separate sign-up flow.
- **Neon instead of Upstash:** Upstash Redis had no free plan on the team, and Neon's free plan was already installed. Postgres also suits battle history.
- **Side games:** research into Zetamac, MathHeads and Math Duel apps showed timed sprints, daily seeded challenges and protected leaderboards are what keep players coming back. Truth or Lie suits the one-phone split-screen format.
- **Keyboard via `e.code`:** QA found numpad input failed under `e.key` with NumLock off.
- **Removed `user-scalable=no`:** an accessibility fix. `touch-action:manipulation` prevents double-tap zoom on the pads instead.
- **Wake Lock:** stops the screen dimming mid-duel.
- **Results "Exhibit" chart:** consulting-style per-question bar chart (the design brief: "McKinsey meets maths, neon edge").
- **`.empty` renamed to `.blank`:** the empty-state class clashed with the `.ans.empty` answer slot and broke the play layout.

## 4. Styling & design system
- **Approach:** hand-written CSS inline in `index.html`, with tokens on `:root`. No CSS framework.
- **Default theme: dark neon.** Light theme via `data-theme="light"` (toggled in Account, stored in `sumduel.theme`). The game screens stay dark in both themes.
- **Tokens:** `--bg #050B18` (consulting navy-black), `--surface #0B1730`, `--ink #EAF0FF`, `--muted #8A99B8`, `--line rgba(140,170,255,.14)`. Players: `--p1 #00E5FF` (electric cyan), `--p2 #FF2E88` (hot magenta), each with `-deep` and `-glow` variants. Status: `--win #B8FF3C`, `--bad #FF4D5E`, `--warn #FFB020`. Light theme: ink `#051C2C`, p1 `#0085A8`, p2 `#D3135F`.
- **Typography:** display = *Instrument Serif* (editorial, italic for emphasis). Numbers/HUD/kickers = *JetBrains Mono* 500/700/800 with tabular numerals. Body = the system sans stack. Fonts load non-blocking (`media=print` swap) and fall back to Georgia and ui-monospace.
- **Motifs:** a 28 px maths-grid background; numbered kickers in small caps ("01 THE ARENA") with a hairline rule; "Exhibit N" captions on charts; KPI tiles with big serif numerals; neon glow only through `text-shadow`/`box-shadow` on player colours.
- **Spacing/shape:** radius 14 px (cards) and 10–12 px (controls); 18 px page gutter; max width 1080 px.
- **Layout:** a bottom tab bar under 760 px and top nav above. The games grid is 1 → 2 → 3 columns (640/980 px breakpoints). Uses `100dvh` with a `100vh` fallback, plus safe-area insets.
- **Motion:** shake + red flash on a wrong answer, green flash on a correct one, a countdown, and canvas confetti on a win or a personal best. **Everything respects `prefers-reduced-motion`** (confetti is skipped).
- **Do NOT:** use CSS `var()` inside SVG presentation attributes (put it in `style=""`, because attributes don't resolve vars in all browsers); add a framework or build step without good reason; re-add `user-scalable=no`; use a class named `.empty` for anything other than the answer slot.

## 5. Frameworks, libraries & tooling
- Runtime dependency: `@neondatabase/serverless@^1.2` (server only). The client has **zero** dependencies.
- Node ≥ 20 (Vercel project uses 26.x). `package.json` has `"type":"module"`, so the API files are ESM.
- Payload: about 7.7 KB (HTML) + 16.2 KB (JS) brotli.
- Local dev: `vercel dev` works once logged in. Alternatively, a small Node server that mounts `api/*.js` (used in QA). QA used headless Chromium through `playwright-core`, kept outside the repo.

## 6. Deploy & environment
- **Hosting:** Vercel, project `sumduel` (`prj_46A6caxkH7B2TjfcipANTRX3rqS4`). Functions run in `lhr1`.
- **Deploys:** the GitHub repo is connected to Vercel, so **pushes to `main` auto-deploy to production**. Manual fallback: `vercel deploy --prod`.
- **Domain:** `sumduel.app` is planned but **not registered** (the 2026-11-07 purchase failed with payment-failed). Once it's bought through Vercel (nameservers on Vercel), attach it to the project and make `www.sumduel.app` redirect to the apex. Until then the app is served only on `*.vercel.app`.
- **Env/secrets:** `DATABASE_URL` (plus the other `POSTGRES_*`/`PG*` vars) is injected by the Neon integration into all environments. Locally: `vercel env pull .env.local` (gitignored). `.env.example` documents the keys. **No secrets in the repo.**
- **Schema changes:** edit `scripts/migrate.js` (idempotent `create … if not exists`), then run `npm run migrate`.

## 7. Roles & permissions
A single role: the **player**. A player can read and write only their own battles and their own display name. Leaderboards are public to read; posting needs a session. There are no admin endpoints. Admin tasks happen directly in the Neon console.
