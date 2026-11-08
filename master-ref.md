# Sum Duel: master reference

> Living architecture reference. Update this **before every push or major change**. If code and this file disagree, that is a bug.

Live: **https://sumduel.app** (`www.sumduel.app` 308-redirects to the apex; `sumduel.vercel.app` also serves it). Vercel project `sumduel`, team `james-projects-f6199c2a`. Repo: `github.com/intox-duck/sumduel`, branch `main`.

---

## ACTIVE TASK / session handoff (updated 2026-11-08)

- **Situation:** v2.1 shipped three things. (1) `sumduel.app` is registered and attached. (2) There is a new **admin portal** at `/admin` (Google sign-in, an allowlist of admin emails, password resets, an audit log). (3) The whole app was **redesigned from dark neon to a "retro mathlib" textbook look**: cream paper, Latin Modern prose, JuliaMono ("SD Lean Mono") for display and numbers, section headings written as Lean comments (`-- §1 The arena`), booktabs tables and numbered equations. The night theme is a "blackboard".
- **Domain:** the first order (`01M6W4V42EZK35YXQJ4WAPNGGB`, 2026-11-07) failed with `payment-failed` because there was no card on the Hobby team. After the owner added a card, the second order `01M6WBKVNMN4DTFC872W79MK4W` **completed** on 2026-11-08: $9.99, 1 year, auto-renew ON, registrant James King (GB). `sumduel.app` and `www.sumduel.app` (308 → apex) were added to the project, and both are verified.
- **Admin portal status:** the code is deployed and `ADMIN_EMAILS=james.s.king@gmail.com` is set on Vercel (all environments, encrypted). **`GOOGLE_CLIENT_ID` is NOT set yet**, so `/admin` shows "Not configured" and nobody can sign in. The owner has to create a Google OAuth **Web** client ID: Google Cloud console → APIs & Services → Credentials → Create credentials → OAuth client ID → Web application. Authorized JavaScript origins: `https://sumduel.app`, `https://www.sumduel.app`, `https://sumduel.vercel.app`, `http://localhost:3999`. No redirect URIs are needed (popup flow), and the consent screen can stay in Testing with the owner as a test user. Then set `GOOGLE_CLIENT_ID` on Vercel and redeploy.
- **Pending owner decisions (asked 2026-11-08, not built yet):** the owner wants to give the site to their 9-year-old daughter and keep hidden "super admin" oversight. Open questions: does the daughter get a limited admin role, or is she just a player? Should "audit logs" grow to cover player activity (sign-ins, sign-ups, password changes, battles), not just admin actions? Should `/admin` auto-sign in through Google One Tap (`auto_select`) when the owner is already signed into Google? Today the owner's player account already looks like a regular user's (nothing in the main app links to or reveals `/admin`).
- **Owner's player account:** `james.s.king@gmail.com` was created on the live site at 2026-11-08 09:01 UTC by the owner. It's a normal player account and is separate from admin access.
- **QA done this session:** 27/27 admin API checks (`qa/test.mjs` in the session scratchpad, not in the repo). They cover forged, expired, wrong-audience, wrong-issuer, unverified and tampered tokens; non-admins; player cookies not granting admin; `%` escaping; lockout clearing; session revocation; audit rows; logout; and 415 on non-JSON. Screenshots in headless Chromium: home, setup, play, countdown, results (a full keyboard-played duel), record (seeded data), account and admin, at 390×844 and 1366×860, paper and night. No console errors except Google's 403 for the fake test client ID.
- **Next ideas (not built):** online duels; friend codes; achievements; season export; server-side Daily verification.
- **Gotchas:**
  - The Vercel CLI hangs silently when it isn't logged in (device-login flow). Run `vercel whoami` first. Prefer the Vercel MCP tools.
  - `vercel link` is interactive. The project is already linked through `.vercel/project.json` (gitignored).
  - Upstash Redis on this team has no free plan, which is why the app uses Neon.
  - The QA harness injects a fake Google JWKS that **expires after 1 hour** (the `_google.js` cache TTL). Restart the harness if admin logins start returning 401.
  - `pkill -f <pattern>` inside a Bash tool call can kill its own shell when the pattern appears in the command line. Kill by PID instead.
  - GitHub release downloads (`/releases/download/...`) returned 504 here. `raw.githubusercontent.com/<repo>/<tag>/<file>` worked.
  - jsDelivr refuses repos over 50 MB (JuliaMono), so don't use it for that.

---

## 1. Architecture & module layout

A static single-page app plus four Vercel serverless functions. There's **no build step** and no framework.

| Path | Role |
|---|---|
| `index.html` | Markup for every view, plus **all CSS inline**. It loads `app.js` with `defer` and preloads three fonts. |
| `app.js` | The whole player client: router, game engines, auth, sync, record, boards, sound, confetti. A single ES5-style IIFE. |
| `admin.html` | The admin portal page (separate from the SPA). Inline CSS, no inline JS, so it can run under a strict CSP. |
| `admin-portal.js` | The admin client: loads Google Identity Services, signs in, searches users, sets passwords, shows the audit log. |
| `sw.js` | Service worker (`VERSION sd-v2.1.0`). Precaches the shell and fonts. Navigations are network-first, but **only `/` is written to the cache**, so other pages can't overwrite the shell. `/api/*` and `/admin*` are never cached. **Bump `VERSION` when shell files change.** |
| `fonts/` | Self-hosted woff2 subsets with their licences (see `fonts/README.md`). |
| `manifest.webmanifest`, `icon.svg` | PWA install. |
| `api/_lib.js` | Shared server helpers: Neon client, `route()` wrapper, scrypt, player sessions, validation. |
| `api/_google.js` | Verifies Google ID tokens with `node:crypto` (RS256 against Google's JWKS, plus `iss`, `aud`, `exp`, `email_verified`). JWKS are cached for 1 h, with a forced refetch on an unknown `kid`. |
| `api/auth.js` | Player auth: `GET` current user; `POST` `enter` (sign in or create), `logout`, `rename`. |
| `api/battles.js` | `GET` own battles; `POST` idempotent batch insert. |
| `api/board.js` | Leaderboards (`sprint`, `daily:YYYY-MM-DD`). |
| `api/admin.js` | Admin API (see §7). |
| `scripts/migrate.js` | Idempotent schema (`npm run migrate`, which reads `.env.local`). |
| `vercel.json` | Clean URLs (so `/admin` serves `admin.html`), `lhr1` functions, and security headers. It adds a CSP, `X-Robots-Tag: noindex` and `no-store` on `/admin*`, and immutable caching on `/fonts/*`. |

Legacy: the v1 single file lives only in `sumduel.zip` (gitignored).

### Client views (hash router)
`#/` Arena · `#/duel`, `#/tol` setup · `#/record` · `#/boards` · `#/account`. The game screens (`#play`, `#handoff`, `#results`) aren't routed. A hash change aborts a running game. `body.ingame` hides the chrome.

## 2. Code & data workflow

### Games (all in `app.js`)
| Game | Players | Rules | Saved as |
|---|---|---|---|
| **Duel** | 2, split screen (P2 rotated 180°) or turns with a handoff screen | Same seeded questions, separate clocks, +3 s (`PENALTY`) per wrong answer, lowest total wins. Answers auto-submit once the digit count matches. | `game:'duel'` |
| **Truth or Lie** | 2, split screen | A shared equation, about 50% true, where lies are near misses. The first correct call scores; a wrong call locks you out for the round. First to 7 (`TOL_TARGET`). | `game:'tol'` |
| **Sprint** | solo | 60 s, medium, all four operations. Score = number correct. | `game:'sprint'` + board |
| **Daily** | solo | 20 questions seeded by the UTC date. Time + penalties. The first attempt counts. | `game:'daily'` + board |

`makeQuestions(n, ops, level, seed)` uses mulberry32. Subtraction and division are built backwards so answers are whole numbers.

**Input:** pointer events on the pads. On a keyboard, `e.code` maps `Digit*` to P1 and `Numpad*` to P2 (works with NumLock either way). In Truth or Lie, P1 presses A/S and P2 presses K/L.

### Battle record shape (JSONB + localStorage)
```js
{ cid, at: ISO, game: 'duel'|'tol'|'sprint'|'daily', mode?: 'split'|'turns',
  cfg: { ops, level, n? }, winner?: 0|1|-1, day?, practice?,
  players: [{ name, time?, raw?, wrong, score?, splits?: [sec…], bestStreak?, wrongBy?: {op:n}, avgRt? }] }
```
The account holder is always player 0.

### Offline-first sync
`recordBattle()` writes `sd_battles` + `sd_pending`. `flush()` POSTs in batches of 200 (the server dedupes on `(user_id, client_id)`). On sign-in, guest battles migrate to the account. Sign-out clears the local cache. The `online` event triggers a flush. Everything works locally if the API is down.

### Player auth (explicit product decision: **no email confirmation**)
- One form: an unknown email creates the account, a known email signs in.
- scrypt (N=16384, r=8, p=1, 64-byte key), stored as `s1$salt$key`.
- Session: a 32-byte token in an HttpOnly, Secure, SameSite=Lax cookie `sd_s`, valid 365 days; only its SHA-256 is stored.
- 10 failures per email+IP per 15 min → 429 (`auth_fails`, key `email|ip`).
- CSRF: SameSite plus JSON-only POSTs (415 otherwise).
- **Consequence:** owning an email isn't proven for player accounts. That's why admin access does **not** trust player accounts (see §7).

### Admin flow (`/admin`)
1. `GET /api/admin` returns `{configured, clientId, admin}`. If `GOOGLE_CLIENT_ID` or `ADMIN_EMAILS` is missing, the portal shows "Not configured" and every POST returns 503.
2. The page loads `accounts.google.com/gsi/client` and renders the Google button (popup UX, `auto_select:false`).
3. Google's ID token is POSTed as `{action:'login', credential}`. The server verifies it (`_google.js`), lowercases the email and checks it against `ADMIN_EMAILS`. A non-admin gets 403 and a `login_denied` audit row.
4. An admin session is a random token in cookie `sd_a`: **Path=/api/admin, HttpOnly, Secure, SameSite=Strict, 8 h**. Its SHA-256 goes in `admin_sessions`. The allowlist is **re-checked on every request**, so removing an email revokes access immediately.
5. `users` search: `ILIKE` with `%`/`_` escaped, newest first, max 100. Each row shows battles, last sign-in (latest session `created_at`) and active sessions.
6. `setPassword {userId, password}` (6–200 chars) scrypt-hashes the password, **deletes all of that user's sessions**, deletes their `auth_fails` rows (lockout cleared) and writes a `set_password` audit row. Nothing is emailed; the admin passes the password on themselves. The client offers a 14-character generator (`crypto.getRandomValues`, no ambiguous characters).
7. `audit` returns the last 50 `admin_audit` rows (`login`, `login_denied`, `set_password`).

### Database (Neon Postgres, `lhr1`)
`users(id, email unique, name, pw_hash, created_at)` · `sessions(token_hash pk, user_id, created_at, expires_at)` · `battles(id, user_id, client_id, game, played_at, data jsonb, unique(user_id, client_id))` · `scores(board, user_id pk, score, created_at)` · `auth_fails(key, at)` · **`admin_sessions(token_hash pk, email, created_at, expires_at)`** · **`admin_audit(id, admin_email, action, target_user_id, target_email, ip, at)`** (append-only). The driver is `@neondatabase/serverless` over HTTP.

### Leaderboard plausibility (not real anti-cheat)
Sprint must be an integer 0–150. A Daily time must be ≥ 7 s and dated today or yesterday (UTC). Daily keeps the first attempt; Sprint keeps the best.

## 3. Reasons for change
- **v1 → v2:** accounts with frictionless sign-up (requested), Neon over Upstash (no free Upstash plan), side games for retention, `e.code` keyboard mapping (a NumLock bug), `user-scalable=no` removed (accessibility), Wake Lock, `.empty` renamed to `.blank` (a class clash).
- **Admin portal behind Google sign-in, not player login (2026-11-08):** player sign-up has no email confirmation, so anyone could register `james.s.king@gmail.com` first and inherit admin if admin trusted player accounts. Google ID tokens prove ownership of the Gmail address. Admin uses a separate cookie (Path-scoped, SameSite=Strict, 8 h) and table, so a stolen player session never grants admin.
- **The service worker only caches `/` (2026-11-08):** the old navigate handler stored *every* navigation response under the `/` key, so visiting `/admin` would have replaced the cached app shell with the admin page.
- **Retro mathlib redesign (2026-11-08):** the owner asked to drop the neon look for a "retro mathlib aesthetic". They picked LaTeX/textbook paper for the whole app and admin, then asked for a "more mathlib/ascii/Lean" headline font. That led to JuliaMono (Lean 4's recommended editor font) for display type and numbers, with Latin Modern kept for prose.
- **Self-hosted fonts instead of Google Fonts:** Computer Modern, Latin Modern and JuliaMono aren't on Google Fonts. The CMU web fonts were tried first and **rejected**: they lack ×, −, ≤ and →. Latin Modern has them. Self-hosting also removes a third-party request and lets the admin CSP use `font-src 'self'`.
- **Theme values renamed** to `paper` (default) / `night` (blackboard). Old saved values (`dark`/`light`) fall back to paper, so every existing device sees the new design.

## 4. Styling & design system
- **Approach:** hand-written CSS inline in `index.html` (and in `admin.html`, which shares the same tokens). Tokens live on `:root`. No framework.
- **Default theme: "paper".** Night theme: `data-theme="night"` ("Blackboard mode" toggle in Account; stored in localStorage `sumduel` → `.theme`). The admin page reads the same setting. Game screens follow the theme (no forced dark screens any more).
- **Paper tokens:** `--bg #F7F3E8` (cream), `--surface #FBF8F1`, `--surface2 #F2EDE1`, `--ink #1A1A1A`, `--muted #4D4A42`, `--faint #77715F`, `--line rgba(26,26,26,.16)`, `--line2 rgba(26,26,26,.5)`. Players: `--p1 #1D4E89` (navy ink), `--p2 #9B1C31` (crimson ink), with `-deep` tints `#E3E9F1` / `#F3E2E1`. Status: `--win #2D6A2E`, `--warn #8E5D07`, `--bad #C0262D`. **`--p1-glow`/`--p2-glow` are `transparent`.** They survive only because `app.js` still writes them into inline `text-shadow`s; this neutralises every glow without touching the JS.
- **Night (blackboard) tokens:** `--bg #1E2A24` slate green, `--ink #EEEDE6` chalk, `--p1 #9CC6EE` chalk blue, `--p2 #F2A7B8` chalk pink, `--win #B9DC97`, `--bad #FF8A80`.
- **Typography:**
  - `--serif` = "SD LM Roman" (Latin Modern Roman 10: regular, italic, bold) for body and prose. Body is 17 px / 1.5 with lining numerals; ledes are justified with `hyphens:auto`.
  - `--caps` = "SD LM Caps" (Latin Modern Roman Caps) for labels, buttons, nav, table heads and badges, always with `text-transform:lowercase` so every letter renders as an even small cap. `font-display:block` avoids a flash of plain lowercase text.
  - `--mono` = "SD Lean Mono" (JuliaMono subset, regular + bold) for **h1/h2, verdicts, game titles, KPI values, questions, answers, clocks, the keypad, equations, the logo and kickers**. Its italic isn't loaded, so `em` inside mono headings is `font-style:normal` and gets colour instead.
- **Motifs:**
  - Kickers read as Lean comments (`::before` "--" plus the `§n` number, e.g. `-- §3.1 Head to head`). App numbering: §1 arena / setup, §2 games, §3 numbers / record (§3.1–3.3), §4 boards, §5 account, §6 preferences.
  - The home lede starts "**Definition 1.1** (Sum Duel)." and ends with an amsthm-style hollow QED box (`.qed`).
  - The home equations show right-aligned equation numbers (1.1)–(1.3) via a CSS counter.
  - Game cards are labelled "Exercise n ·" via a counter. The main-event card has a double-rule frame.
  - Tables are **booktabs**: 1.6 px top and bottom rules, a 0.8 px rule under the header, no vertical lines. The KPI row and history list use the same rules.
  - Chart captions read "Figure 1: …", centred.
  - Toggles are ballot boxes. Duel halves are split by a double rule.
- **Shape:** `--r`/`--r-sm` = 2 px; cards and panels are square (radius 0). 18 px gutter, max width 1080 px.
- **Layout:** a bottom tab bar under 760 px and top nav above. Games grid 1 → 2 → 3 columns. `100dvh` with a fallback; safe-area insets.
- **Motion:** shake + red wash (`--bad` at 14% opacity, no blend mode, so it works on paper and slate) on a wrong answer; countdown; confetti in ink colours. Everything respects `prefers-reduced-motion`.
- **Do NOT:**
  - use `var()` inside SVG presentation attributes (use `style=""`);
  - add a framework or build step without good reason;
  - re-add `user-scalable=no`;
  - use `.empty` except for the answer slot;
  - bring back glows or neon gradients;
  - load fonts from Google Fonts (the admin CSP blocks it);
  - use the font names "JuliaMono" or the original Latin Modern file names for the subset files (licence renaming requirements, see `fonts/README.md`).

## 5. Frameworks, libraries & tooling
- Runtime dependency: `@neondatabase/serverless@^1.2` (server only). The player client has zero dependencies. The admin client loads Google Identity Services (`accounts.google.com/gsi/client`) at runtime.
- Node ≥ 20 (the Vercel project uses 26.x), ESM.
- **Fonts** (`fonts/`, about 145 KB in total, cached immutable):

  | File | Size |
  |---|---|
  | `sd-lmroman-regular.woff2` | 19.6 KB |
  | `sd-lmroman-italic.woff2` | 22.2 KB |
  | `sd-lmroman-bold.woff2` | 19.4 KB |
  | `sd-lmroman-caps.woff2` | 18.9 KB |
  | `sd-leanmono-regular.woff2` | 26.2 KB |
  | `sd-leanmono-bold.woff2` | 26.6 KB |

  Built with fonttools `pyftsubset --flavor=woff2`. Latin Modern source: CTAN `fonts/lm/fonts/opentype/public/lm/*.otf`, unicode set `U+0020-007E,U+00A0-00FF,U+0131,U+0152-0153,U+2013-2014,U+2018-201E,U+2022,U+2026,U+2032-2033,U+2039-203A,U+2190-2193,U+2212,U+2215`. JuliaMono v0.63.2 (raw.githubusercontent) gets the same Latin set plus Greek, subscripts/superscripts, ℕℤℚℝ, arrows and common maths operators; its `name` table is rewritten to "SD Lean Mono".
- **Local QA:** the session scratchpad `qa/server.mjs` serves static files plus `api/*.js`, injects a local RSA JWKS into `_google.js` through `_setKeysForTest` and mints test ID tokens at `/__mint`. `qa/test.mjs` runs the 27 admin checks. `qa/cleanup.mjs` deletes `qa.%@example.com` users, their `auth_fails`, and **all** `admin_sessions`/`admin_audit` rows, so don't run it once real admin history matters. Screenshots come from `playwright-core@1.56.1` with the cached `chromium_headless_shell-1208`.

## 6. Deploy & environment
- **Hosting:** Vercel, project `sumduel` (`prj_46A6caxkH7B2TjfcipANTRX3rqS4`, team `team_w10Hnku1fiDJkY4FcEBrB68v`), Hobby plan (with a card on file for domain purchases). Functions run in `lhr1`.
- **Deploys:** pushes to `main` auto-deploy to production. Manual fallback: `vercel deploy --prod`.
- **Domains:** `sumduel.app` (apex, production), `www.sumduel.app` → 308 to the apex, `sumduel.vercel.app`. Registered through Vercel on 2026-11-08, renews yearly (auto-renew ON).
- **Env/secrets:**

  | Variable | Source / status |
  |---|---|
  | `DATABASE_URL` + `POSTGRES_*` / `PG*` | Injected by the Neon integration |
  | `ADMIN_EMAILS` | Comma-separated, set (encrypted, all environments) |
  | `GOOGLE_CLIENT_ID` | **To be set by the owner**, see the handoff |

  Locally: `vercel env pull .env.local` (gitignored). `.env.example` documents every key. No secrets in the repo.
- **Schema changes:** edit `scripts/migrate.js`, then run `npm run migrate` (already applied for the admin tables on 2026-11-08).

## 7. Roles & permissions
| Role | How you get it | Can |
|---|---|---|
| **Player** | Email + password at `#/account` (no confirmation) | Read and write their own battles and display name; post board scores; read boards. |
| **Admin** | Google sign-in at `/admin` with a verified Google email listed in `ADMIN_EMAILS` | Search all users (email, name, joined, last sign-in, battle count, active sessions); set any player's password (signs them out everywhere and clears lockout); read the admin audit log. Can't read battle contents or password hashes through the portal. |

- A player session **never** grants admin, even when the emails match. Admin sessions are separate (`sd_a`, `admin_sessions`).
- Nothing in the player app links to or reveals `/admin`. The page is `noindex` and uncached.
- Every admin login, refused login and password change is written to `admin_audit` with the admin's email and IP.
