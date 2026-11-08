# Sum Duel: master reference

> Living architecture reference. Update this **before every push or major change**. If code and this file disagree, that is a bug.

Live: **https://sumduel.app** (`www.sumduel.app` 308-redirects to the apex; `sumduel.vercel.app` also serves it). Vercel project `sumduel`, team `james-projects-f6199c2a`. Repo: `github.com/intox-duck/sumduel`, branch `main`.

---

## ACTIVE TASK / session handoff (updated 2026-11-08)

- **v2.7 (latest): new fonts, illustrations, a home leaderboard and a players dashboard.** The owner said: "I don't like the font or the lack of visuals, show a leaderboard on the homescreen, all users reports are shown on a public facing dashboard once players login."
  - **Fonts:** Nunito (body, labels, buttons, tabular numbers) and Fredoka (headings, logo, questions, keypad, big numbers). Both are self-hosted under `/fonts`: the unmodified Fontsource Latin variable files, SIL OFL. They replace Latin Modern and JuliaMono, which are deleted from the repo along with their licences.
    - Labels are no longer lowercased into small caps (`text-transform:none` everywhere); they use Nunito 800.
    - Glyphs outside the Latin subset (→ ✦ ⌫ ≤) fall back to the system font.
  - **Visuals:** original inline-SVG illustrations, coloured only by `.il-*` CSS classes, so both themes work:
    - a hero scene: two round sea creatures, teal "7 × 6?" and pink "42!", with a sun and waves; it bobs gently, and the animation is off under reduced motion;
    - a picture per game card: blobs (Duel), two phones and a bolt (Live), tick and cross bubbles (Truth or Lie), a stopwatch (Sprint), a calendar with a sun (Daily), a fish, star and shell (Little Ones);
    - blob avatars (`avatar(name)`, colour chosen by a hash of the name).
  - **Home leaderboard (`#homeBoard`, `renderHomeBoard()`):** public, so guests see it too. Today's Daily (fastest) and Sprint (most correct), each a podium for the top 3 plus rows 4–5, "You're #n" when you're outside the top 5, and an empty state with a play button. It uses the existing public `GET /api/board`.
  - **Players dashboard (`#/players`, new "Players" tab; the tab bar is back to 5):** visible to **signed-in players only**. Signed out, it shows a sign-in prompt.
    - **How "all users reports" was read:** every player's *game report*. It shows **display names only**: no emails, roles, IPs, chat, or the safeguarding audit reports, which stay super_admin-only. The hidden super_admin (shown as "DaddyKing") appears as an ordinary player, so the role stays hidden. Real players, including Imogen, are listed by display name.
    - **Contents:** totals (players, battles, this week, played today); a "Battles per day" bar chart for the last 14 days (single series; drawn at the container's real width so the axis text stays 12 px; hover tooltip; "Show as a table"); a search box and sort (most games / most wins / best Sprint / fastest Daily / recent); one card per player with games, wins, best Sprint, fastest Daily, a W/L/D bar (wins, losses, draws; text label "7 W · 3 L · 0 D" + % won), a game mix, joined date and last played.
    - **API:** `GET /api/board?b=players` (in `board.js`, so no new function; `requireUser`, so 401 when signed out).
  - **Chart colours** (validated with the dataviz `validate_palette.js`):
    - wins `--c-win`: day `#00879B` / night `#21A2B5`;
    - losses `--c-loss`: day `#D6336C` / night `#D94C82`;
    - draws `--c-draw`, the neutral midpoint: day `#868CA3` / night `#7D86A8`.
    - Results: CVD ΔE 10.4 (day) and 8.0 (night); ≥ 3:1 against the chart surface.
  - Kicker numbers: Players 5, Account 6, Preferences 7; the home "Top players" and "Your numbers" kickers have no number. Service worker `sd-v2.7.0`.
  - **QA:** screenshots on phone (day) and desktop (day and night) with 5 seeded `qa.design.s*` players (since deleted; the live boards were empty before and after). The Little Ones run still passes; no console errors.
  - **Test-harness gotcha:** the screenshot scripts inject an emoji fallback font by overriding `--serif/--mono/--caps`. Keep their family names in step with the real fonts, or every screenshot shows fallback fonts (that happened once this session).

- **v2.6: chat switched off, adversarial design review, new logo and site artefacts.** The owner asked to "turn off all chat features and do one adversarial design review using claude design and update all site artefacts, including the logo and push".
  - **Chat off (reversible):**
    - The switch is `api/_features.js` → `CHAT_ENABLED = false`. When it's false:
      - `/api/chat` returns 404 "Chat is turned off" for every method;
      - `/api/admin` refuses `chat`, `mutes`, `flags` and `review`, and `GET /api/admin` returns `features:{chat:false}`;
      - the portal hides the Chat and Flags tabs, the mute selects and the "n chat messages" meta (unless a player has old messages).
    - Client: `CHAT_ON = false` in `app.js`, so `#/chat` falls through to home. The Chat links are removed from the top nav and the tab bar, which now has 4 columns.
    - Kept dormant: the chat JS/CSS, `_safety.js` (still used for Live Duel game names), the tables, the activity-log labels, and audits (their chat counts just read 0).
    - **To re-enable:** set both flags to true, restore the two `<a href="#/chat" data-tab="chat">` links in `index.html`, set the tab bar back to `repeat(5,1fr)`, and renumber the Account/Preferences kickers.
    - At switch-off the DB had 0 chat messages, 0 unreviewed flags, 0 open reports and 0 mutes, so nothing was stranded.
  - **Design review:** done in **Claude Design** (the Design artifact type), canvas https://claude.ai/artifact/MfqwNUcqKa2g94aQSoNdUc (private; the owner shares it from its Share menu).
    - It has three boards: ranked findings; logo and site artefacts; before/after screenshots.
    - Inputs: 38 screenshots from the local QA server (phone 390 day, desktop 1280 day and night, admin), taken with `qa.design.*@example.com` test users, since deleted.
    - Ten findings, all fixed (§3 "v2.6 review"). Four were challenged and kept: textbook numbering and the Lean admin headings (both owner direction), the masked super_admin row showing "Set password" (role hiding), and the results chart's first bar including the GO reaction time (flagged).
  - **New logo (v2.6 mark):** a ÷ whose dots are the two players (teal `#0F7C8C` above, raspberry `#D6336C` below) and an ink `#22223B` bar, flat on sand `#FFF8EE` with a `#BFE6EA` scalloped sea. It replaces the v1 neon mark (`#050B18`, glows), which broke the "no neon" rule.
  - QA: the Little Ones run (10 rounds, no errors) and the chat-off API checks all pass. Service worker `sd-v2.6.0`.

- **v2.5: "Little Ones", a level for 4-year-olds.** The owner asked for "a level, inside the app, for 4 year olds". It's a sixth game card on the Arena ("Count with me", tag AGE 4+ · NO CLOCK), full width under the others. It's client-only: no API, no DB, no battle record.
  - **Why it isn't just a "tiny" difficulty:** the existing games need reading, typing on a keypad and beating a clock with penalties, and 4-year-olds can do none of those. So it's a separate picture game. Pictures are emoji (no assets). Answers are three big buttons. A spoken voice reads every prompt. There's no timer and no penalty.
  - **10 rounds (`LITTLE_PLAN` in `app.js`):** count 1–3, count 2–4, more, count 3–5, add (sum ≤ 3), more, count 4–6, add (≤ 4), count 5–7, add (≤ 5). Each round picks a different picture from `LITTLE_THINGS`.
  - QA: a Playwright run on phone (paper) and desktop (night) plays all 10 rounds, including wrong answers, the count-along and the "more" rounds. It checks the end screen, the star total and the return to the Arena, with no console errors. Headless Chromium here has no emoji font, so the screenshot run loads Noto Color Emoji (from `@fontsource/noto-color-emoji`) into the test pages only. Real devices use their own emoji. Service worker `sd-v2.5.0`.

- **v2.4: Imogen's account, password changes, friendlier design.**
  - **Imogen** (`imogen.o.king@gmail.com`, user id **71**, the owner's 9-year-old daughter) was created directly in the DB by a one-off script with role **`admin`**, starter password `password` and `must_change_pw = true`. On first sign-in she's held on a "pick your own password" screen until she sets one (8+ characters, not easy ones like `password…`/`12345678`).
  - **Requested, but deliberately NOT built:**
    1. Imogen as `super_admin`. That role includes the safeguarding queue (flagged grooming and self-harm content from other children), every child's activity and IP history, and the power to take over any account, which is unsuitable for a 9-year-old. `admin` gives her a full-feeling portal (players, password resets, chat moderation).
    2. A decoy reset where her changing the owner's password would appear to succeed but secretly do nothing (deceptive auth behaviour). The owner's account is protected honestly: admins get the generic "This account can't be changed from here.", the same message as for any protected account, which doesn't reveal the super_admin role.
    3. Changing the owner's own password to a generated string. Not done, because a lost reply would lock the owner out of super_admin. The owner can now change it themselves (Account → Change password).
  - **Design:** a "seaside" friendly layer for a 9–11 audience: warm cream with teal sea and raspberry pink, rounded cards and pill buttons, a scalloped wave under the header, a polka-dot background, simpler wording. The night theme is now "Night by the sea" (navy). Service worker `sd-v2.4.0`.
  - **QA:** 129 checks pass:
    - 17 password-flow checks (`qa/test4.mjs`): starter login, every API blocked until the change, wrong/short/easy passwords refused, other devices signed out, the old password dead, the portal opening afterwards, dad shown as a player and protected;
    - 63 v2.2 checks (updated: admin resets now force a change);
    - 49 live checks.

    Screenshots (`qa/shots6.mjs`): home on desktop and phone, day and night; the forced-change screen; the account page; play. Test data cleaned up; users are id 7 (super_admin) and id 71 (Imogen, admin, starter password still pending).

- **v2.3: Live Duel.** Two players race on **separate devices**. Anyone signed in can create a game, public or **private with a password**. Players wait in a lobby or room, both press Ready, and a server-timed countdown starts. Results, both battle records and a rematch flow are handled server-side. It's built on the **existing Neon database**: the owner said "Use it" after asking for a new Neon instance (see the next bullet). QA:
  - 49/49 API checks (`qa/test3.mjs`);
  - the 61 v2.2 checks re-run;
  - a two-browser end-to-end test (`qa/shots5.mjs`): a desktop and a phone browser play a full private game through the UI, including a wrong password, the win shown on both devices, and the rematch invite and join.
- **Neon provenance (corrected 2026-11-08):**
  - The Neon Marketplace integration (`icfg_EyO6QHtjMfDAPR08XyR45pyR`, free plan) was installed on the team on **2026-04-22** under the owner's Vercel user.
  - The `sumduel-db` database was added on **2026-11-07 at 23:18:36 UTC**, 6 minutes after the Vercel project was created. `.env.local` was written by `vercel env pull` at 23:18:50. That matches the previous Claude session provisioning it with the **Vercel CLI** (`vercel` v54.9.0, installed at `/mnt/c/Users/10850k/AppData/Roaming/npm/vercel` and logged in).
  - **The Vercel MCP tools can't create Neon stores** (only Blob and Edge Config), **but the CLI can**: `vercel integration add neon`. An earlier message in this session wrongly said a Neon database couldn't be created at all.

- **Situation:** v2.2 replaces the v2.1 Google-sign-in admin portal (which was never switched on) with **roles stored in Neon**. It also adds a full **activity log**, an **mIRC-style chat** with safeguarding filters, a **flag review queue** and **daily automated safeguarding audits**. The owner is giving the site to their 9-year-old daughter as a gift. The owner is a hidden **super admin**. The daughter will be an **admin** (mostly a player, plus moderation and password resets), and her actions are visible to the owner.
- **Roles now:** `james.s.king@gmail.com` (id 7) = `super_admin` (set with `npm run role`). `imogen.o.king@gmail.com` (id 71) = `admin`, created 2026-11-08 with a starter password she must change.
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

A static single-page app plus seven Vercel serverless functions (Hobby limit 12; `_`-prefixed files are shared modules, not functions). There's **no build step** and no framework.

| Path | Role |
|---|---|
| `index.html` | Markup for every view plus **all CSS inline**. Preloads three fonts. Loads `app.js` (defer). |
| `app.js` | The whole player client: router, games (incl. **Little Ones**), auth, sync, record, boards, **chat**, sound, speech, confetti. ES5-style IIFE. |
| `admin.html` + `admin-portal.js` | The admin portal at `/admin` (clean URL). Inline CSS, no inline JS (strict CSP). Shows a plain 404 page to anyone who isn't an admin. |
| `sw.js` | Service worker `sd-v2.6.0`: precaches the shell and fonts; navigations network-first with **only `/` cached**; never caches `/api/*` or `/admin*`. Bump `VERSION` when shell files change. |
| `fonts/` | Self-hosted woff2 subsets and their licences (`fonts/README.md`). |
| `api/_lib.js` | Neon client, `route()`, scrypt, player sessions (`currentUser` returns `role`, `muted_until`), `publicUser`, `isMod`/`isSuper`, **`logEvent()`**. |
| `api/_safety.js` | Chat safeguarding filter (`screen()`). |
| `api/_audit.js` | `runAudit(req, actor, trigger)`: builds and stores a safeguarding report. |
| `api/auth.js` | Player auth (`enter`, `logout`, `rename`). Logs sign_up, sign_in, sign_in_failed, sign_in_locked, sign_out and rename. |
| `api/battles.js` | Own battles GET; idempotent POST. Logs `battle_saved` with a compact summary. |
| `api/board.js` | Leaderboards (public GET), score POSTs (logs `score_posted`), and **`?b=players`**: the v2.7 players dashboard data (signed-in only; display names and stats only). |
| `api/chat.js` | Chat (poll, send, report, delete, mute). Exports `CHANNELS`. **Switched off (v2.6):** returns 404 while `CHAT_ENABLED` is false. |
| `api/_features.js` | Feature switches. `CHAT_ENABLED = false` (v2.6). |
| `icon.svg`, `icon-maskable.svg` | The v2.6 seaside ÷ mark (a rounded tile; a full-bleed maskable version with the artwork at 86 % in the safe circle). |
| `apple-touch-icon.png` (180), `icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, `favicon-32.png`, `og.png` (1200×630) | Rendered from the SVGs and an HTML share card with headless Chromium (render scripts live in the session scratchpad, not the repo). Re-render them whenever the mark changes. |
| `api/admin.js` | Admin API (role-gated, see §7). |
| `api/live.js` | Live Duel API: lobby, create, join (with password), ready, progress, leave, claim, rematch. |
| `api/_questions.js` | Server copy of `makeQuestions` and `RANGES`. **Keep it identical to `app.js`.** |
| `api/audit-cron.js` | Vercel cron target. Checks `Authorization: Bearer $CRON_SECRET`, then calls `runAudit`. |
| `scripts/migrate.js` | Idempotent schema (`npm run migrate`). |
| `scripts/role.js` | `npm run role -- <email> <player|admin|super_admin>`. **The only way to create a super_admin.** Logs `role_set_cli`. |
| `vercel.json` | Clean URLs, `lhr1`, headers (strict CSP + noindex + no-store on `/admin*`, immutable `/fonts/*`), and `crons: [{ path: /api/audit-cron, schedule: "0 7 * * *" }]`. |

### Client views (hash router)
`#/` Arena · `#/duel`, `#/tol` setup · **`#/live` (lobby) and `#/live/CODE` (room)** · `#/record` · `#/boards` · **`#/players` (v2.7 dashboard, signed-in only)** · `#/chat` (off in v2.6; it falls through to home) · `#/account`. The game screens aren't routed. `route()` calls `chatStop()` and `liveStop()` on every navigation, so polling only runs while that view is open. Leaving a live game by navigating away doesn't forfeit, but after 25 s of silence the opponent can claim the win.

## 2. Code & data workflow

### Games, battle record shape, offline-first sync
Unchanged from v2. Duel, Truth or Lie, Sprint and Daily live in `app.js`. Battles are written to `sd_battles` + `sd_pending` and flushed in batches of 200, deduped on `(user_id, client_id)`. Guest battles migrate to the account on sign-in. Shape:
```js
{ cid, at, game: 'duel'|'tol'|'sprint'|'daily', mode?, cfg: { ops, level, n? }, winner?: 0|1|-1, day?, practice?,
  players: [{ name, time?, raw?, wrong, score?, splits?, bestStreak?, wrongBy?, avgRt? }] }   // account holder = player 0
```

### Little Ones (v2.5, for 4-year-olds, client-only)
- **Entry:** the Arena card `data-go="little"` → `startLittle()`. It renders into `#play` as a game screen (`G.kind = 'little'`), so any navigation calls `abortGame()`, which also cancels speech (`hush()`). It isn't hash-routed, like the other games.
- **Flow:**
  - A start cover with a big green ▶. It gives the parent a moment to hand over the device, and the tap unlocks audio and speech on iOS.
  - Then 10 rounds from `littleRounds()`, and an end screen: trophy, 10 stars, "N stars altogether", Play again / All done.
- **Round kinds:**
  - `count`: pictures in one or two centred rows; "How many fish?".
  - `add`: group + group; "How many … altogether?".
  - `more`: two big side buttons; "Which side has more …?". The counts differ by 2–3, so the answer is easy to see.
  - For count and add, the choices are the answer plus two neighbours (±1/±2, 1–9), sorted ascending. Each button shows the numeral plus that many dots.
- **Kind feedback, never a fail state:**
  - **Tapping a picture** numbers it (badge) and says the number, so the child can count by touch.
  - **A right answer** turns the button green, makes the pictures hop, plays a cheer and fills a progress star. The next round starts after 2.3 s.
  - **A wrong answer** makes the button wobble and greys it out. A soft two-note "boop" plays (not the harsh `sfx.bad`), the voice says "Nearly! Let's count them together." and the pictures are then numbered one by one, aloud (`littleCountAlong`). Taps are blocked while that runs.
- **Voice:** `say()` uses `speechSynthesis` (an en-GB voice if one exists, rate 0.9, pitch 1.15). It's gated on the **Sound** setting and does nothing without the API. 🔊 repeats the prompt. `add` prompts are read as "two crabs, and one more. How many crabs altogether?".
- **Keyboard:** digit keys pick a number choice; ←/→ pick a side in `more` rounds.
- **State:** only `localStorage sd_little_stars` (a running star total, +10 per finished game). **Nothing is sent to the server or written to the battle record.** It's for little siblings and friends playing as guests, and it keeps the record's stats meaningful.

### Player auth (explicit product decision: no email confirmation)
- One form: an unknown email creates the account, a known email signs in.
- scrypt; an HttpOnly + Secure + SameSite=Lax cookie `sd_s` valid 365 days, storing only the token's SHA-256.
- 10 failures per email+IP per 15 min → 429.
- `publicUser` adds `admin:true` **only** for the `admin` role (it drives the "Admin tools" button on the Account page). **super_admin is indistinguishable from a player in every player-facing response.**
- **Forced password change (v2.4):** `users.must_change_pw` is set for starter accounts and by **every admin password reset** (except resetting your own). While it's set:
  - sign-in works and `publicUser` carries `mustChange:true`;
  - `requireUser` returns 403 for every API (battles, boards, chat, live) and `/api/admin` returns 404;
  - the client router sends every route to `#/account`, which shows only the "Hi <name>! Pick your own secret password" form.
- **`POST /api/auth {action:'changePassword', current, password}`:** checks the current password; the new one must be 8–200 characters, differ from the old, and not start with `password`, `12345678`, `qwertyui` or `sumduel`. It clears `must_change_pw`, signs out every other session (keeping this device) and logs `password_changed`. Signed-in players also get a collapsible "Change password" panel on Account.

### Activity log (`activity_log`, append-only, read only by super_admin)
`logEvent(req, actor, action, {target, detail})` stores the actor id, email and role, the action, the target id and email, `detail` jsonb, IP and user agent. It never throws.

| Group | Actions |
|---|---|
| Accounts | `sign_up`, `sign_in`, `sign_in_failed`, `sign_in_locked`, `sign_out`, `rename` |
| Games | `battle_saved` (summary: game, winner, opponent, times or scores), `score_posted` |
| Chat | `chat_message` (text, plus flags and the original if masked), `chat_blocked` (reason + the attempted text), `chat_report`, `chat_delete` (keeps the text), `chat_mute`, `chat_unmute` |
| Admin | `admin_open`, `admin_password_reset`, `admin_role_change`, `admin_review`, `audit_run`, `audit_reviewed`, `role_set_cli` |

There's no retention limit: everything is kept.

### Chat (`#/chat`, `api/chat.js`): SWITCHED OFF in v2.6, documented for re-enabling
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
- **Admin tabs (chat off, v2.6):** **Players** only (search; set password); mute and the Chat/Flags tabs come back with `CHAT_ENABLED`. When chat is on: **Players** (+ mute) and **Chat** (recent messages in either channel incl. removed ones without text; delete; mute 1 h; mutes list with unmute).
- **Super admin tabs add** (Flags only while chat is on):
  - **Flags**: unreviewed flagged and reported messages, wellbeing and personal-info first, each with 5 lines of context and its reports. Actions: mark reviewed, remove + reviewed, mute 1 h or 1 day. The tab badge shows the count.
  - **Activity**: filter by group and search email, text or IP; 100 rows at a time with "Load older"; Export CSV.
  - **Audits**: list, "Run audit now", mark reviewed.
- **Super admin also gets:** a role dropdown (player ↔ admin; never super_admin), Details per player (scores, battles, chat messages incl. removed, activity), and the true roles in every list.
- **Password reset:** the admin sets or generates a password. This ends the target's sessions (except the caller's own) and clears `auth_fails`. Nothing is emailed.

### Live Duel (`#/live`, `api/live.js`, `live_games`)
- **Lobby (`#/live`):** create a game (name, operations, difficulty, 5/10/15/20 questions, public or private + password of 3–50 characters, scrypt-hashed), join by 5-character code, or pick from the open-games list (polled every 3 s). Private games ask for the password inline.
  - One active game per player: creating or joining leaves your other lobby.
  - Game names go through the chat safeguarding filter: PII and links are blocked, profanity is masked.
- **Room (`#/live/CODE`):** polled every 1.3 s. Both player cards (**you are always blue, your opponent pink, on every device**), Ready toggles, Copy link / share sheet, Leave.
  - Statuses: `open` → `full` → `playing` → `done`, or `cancelled` / `abandoned`.
  - Housekeeping on each lobby poll: a lobby whose host has been silent for 60 s is abandoned; a silent guest is dropped back to `open`; a game where both players have been silent for 5 min is abandoned.
- **Start:** when both are ready, the server generates seeded questions (`_questions.js`) and sets `start_at = now() + 5 s`.
  - Questions, including answers, are only sent from 3.5 s before GO.
  - Each client estimates its clock offset from the lowest-latency poll (`LV.offset`) and counts down to `start_at` on the game cover. Late arrivals start with their elapsed time already counted.
- **Play:** reuses the solo play screen and keypad (`makeHalf`, `press`, `finish`). The opponent strip in the top bar shows their progress bar, `idx / n`, wrong count and "done ✓", polled every 0.9 s.
  - Each correct or wrong answer sends `progress` (queued, retried, only moves forward).
  - The final report carries the device stopwatch time plus splits, best streak and wrong answers per operation.
- **Result (decided on the server, once, through a conditional update):**
  - **Time:** the device time is used if it's within −5 s / +1 s of the server-measured time, otherwise the server time is used; then +3 s per wrong answer.
  - **Winner:** both finished → lower time (a gap under 5 ms is a draw); one finished → that player; timeout (`max(120, n×20)` s) → whoever got further.
  - **Forfeits:** `leave` mid-game is a forfeit, and so is `claim` after 25 s of opponent silence.
  - Each player gets a `battles` row from their own perspective (`cid live-<id>`, `mode:'live'`), so the client's re-save dedupes. The result also carries both players' splits for the chart.
- **Rematch:** either player creates a new game with the same settings, name and password, with the other player as `invited_id`. The old game's `rematch_code` shows the opponent a "wants a rematch → Join" bar on their results screen. The invited player skips the password.
- **Logging:** `live_create`, `live_join`, `live_join_failed` (10 per 10 min → 429), `live_start`, `live_finish` (both players' times and the winner), `live_leave`. These appear in the activity log under "Games & scores" and as totals in audits.
- **Budget:** 2 players × about 1 call per second during a game. A 1-minute game is about 150 calls in total, which is fine on Hobby.

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
  - `users(id, email unique, name, pw_hash, created_at, role ['player'|'admin'|'super_admin'], muted_until, must_change_pw)`
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
- **v2.3 table:** `live_games(id, code unique, name, host_id, guest_id, invited_id, is_private, pass_hash, cfg, status, host_/guest_ready, host_/guest_seen, questions, start_at, host_/guest_idx, _wrong, _done_at, _raw, _extra, result, rematch_code, created_at, updated_at)`

## 3. Reasons for change
- **v1 → v2:** frictionless accounts, Neon (no free Upstash), side games, `e.code` keys, accessibility fixes.
- **v2.1 redesign:** the owner asked for a "retro mathlib aesthetic" (LaTeX paper), then a Lean-style monospace headline. The fonts are self-hosted Latin Modern + JuliaMono ("SD Lean Mono"). CMU was rejected because it lacks ×, −, ≤ and →.
- **v2.1 → v2.2 admin:** Google OAuth was dropped at the owner's request ("too hardcore"). Roles live in the DB. super_admin can only be set from the CLI, so no UI path can create or remove one. It's bound to an existing account row.
- **Hidden super admin:** the owner asked that their account look like a regular user until they type `/admin`. Hence: no `admin` flag in `/api/auth` for super_admin, no `@` in chat, role masked as "player" in admin views, and generic wording when admins try to act on it.
- **Admins can't touch admin or super accounts:** without that, the daughter (admin) could reset the owner's password and take over the super_admin account.
- **Chat safeguarding:** the users are children. Personal details and links are blocked outright; grooming and wellbeing signals are flagged for an adult instead of silently blocked, so context is kept. Nothing is hard-deleted.
- **Audit window on DB time:** QA found a 3 s drift between the function host and Neon, which dropped fresh events from audits.
- **Live Duel design (v2.3):**
  - Polling instead of websockets, because Vercel functions can't hold sockets and the owner asked to stay on Neon/Vercel.
  - The server owns the clock and the verdict, so a child's device can't fake a win by editing JavaScript beyond about 1 s of time.
  - Questions are withheld until just before GO, so nobody can practise them in the lobby.
  - Battles are written server-side, so the record exists even if a device closes on the results screen.
  - You = blue on every device, because the results screen and the record always treat the device's owner as player 0.
- **v2.6 review, ranked by severity (finding → fix):**
  1. **Critical: the logo was from the dead v1 neon design.** → a seaside ÷ mark plus a header lockup in the app and admin.
  2. **Critical: the manifest colours were `#050B18`** (a black splash and status bar on install). → `#FFF8EE`.
  3. **High: iOS ignores an SVG apple-touch-icon** (it showed a screenshot), there were no PNG icons, and the maskable icon had no safe zone. → a full PNG set.
  4. **High: no og:image, and the "one phone" pitch was outdated.** → `og.png` plus new copy and `twitter:card`.
  5. **High: on phones the Game 6 tag collided with its eyebrow.** → tags are `position:static` at ≤ 520 px.
  6. **Medium: the phone hero equations pushed every game below the fold.** → hidden below 640 px.
  7. **Medium: justified, auto-hyphenated prose made rivers** on narrow screens. → left-aligned, `hyphens:manual`, in the app and the admin.
  8. **Medium: the signed-out "?" avatar read as Help.** → a person glyph.
  9. **Low: the account label was in mono capitals, with dead space and ragged buttons.** → `.flab`, `.panel .err:empty`, `.acts-grid`.
  10. **Low: kicker numbers had a gap after chat was removed.** → Account 5, Preferences 6.
- **Little Ones (v2.5):** the owner asked for a level for 4-year-olds. The design rules follow from what that age can do: they can't read (so a voice and pictures), they can't use a keypad (so 3 huge buttons, at least 88 px tall), they shouldn't be timed or penalised (so no clock, a soft wrong-answer sound, and a count-along instead of a fail), and they love collecting things (so stars). It's kept out of the battle record so it doesn't inflate the stats or need an account.
- **v2.1 service worker fix:** only `/` is cached, so other pages can't overwrite the shell.

## 4. Styling & design system
- **Approach:** hand-written CSS inline in `index.html` and `admin.html` (shared tokens). No framework.
- **Audience (v2.4):** the owner's daughter (9, reasoning at about 11) and her friends. Keep wording short and plain, keep it colourful but calm. Never put her name or home town in public page text.
- **Layers:** a **v2.7 layer** (last before the reduced-motion rule: type tuning, `.il-*` illustration colours, `.gart` card art, `.hb*` home board, `.stats`/`.chart`/`.pcard`/`.wld` dashboard, `.tip`, chart tokens `--c-win/--c-loss/--c-draw` and `--il-*`), on top of the v2.6 review layer, on top of the v2.1 textbook base (Latin Modern + Lean Mono, booktabs, numbered equations) plus a **v2.4 "friendly layer"**: a CSS block at the end of the `index.html` styles that overrides radii, button and segment colours, header wave, background dots and kicker star. Remove that block to get the plain textbook look back.
- **Themes:** `paper` (default, "seaside day") and `night` ("Night by the sea", the Account → Night mode toggle; stored in localStorage `sumduel.theme`). Old `dark`/`light` values fall back to paper.
- **Day tokens:** `--bg #FFF8EE` (warm sand-cream), `--surface #FFFFFF`, `--surface2 #FFF3E6`, `--ink #22223B`, `--muted #4A4E69`, `--faint #70758F`, `--line rgba(34,34,59,.13)`, `--line2 rgba(34,34,59,.34)`, `--p1 #0F7C8C` (sea teal), `--p2 #D6336C` (raspberry), deep tints `#DDF3F4`/`#FCE4EC`, `--win #2B8A3E`, `--warn #B35C00`, `--bad #C92A2A`, `--sun #F4B400`, `--on-accent #FFFFFF`. `--p1-glow`/`--p2-glow` are `transparent`, which neutralises the glows `app.js` writes inline.
- **Night tokens:** `--bg #13203A` (navy), `--surface #1A2A48`, `--ink #F5F3FF`, `--p1 #5CD3E0`, `--p2 #FF8FB8`, `--win #8CE99A`, `--bad #FF8787`, `--on-accent #13203A`. `theme-color` meta: day `#FFF8EE`, night `#13203A`.
- **Friendly layer details:**
  - `--r 16px` / `--r-sm 12px` on cards, panels, lists, KPI rows and keypads;
  - pill-shaped buttons, segments, filters, tags and toasts; primary buttons raspberry; selected segments and ops teal;
  - cards lift on hover with a 4–6 px "shadow ledge";
  - a teal scalloped wave under the sticky header (`.top::after` radial gradients); a 22 px polka-dot background;
  - kicker marker ✦ in pink with plain numbers (no `§`, no `--`);
  - game cards labelled "Game n ·"; home lede "How it works: …" (no "Definition", no QED box).
- **Type (v2.7):** the token names are historical; read them as roles.
  - `--serif` = Nunito, for prose.
  - `--caps` = Nunito, for labels, buttons, nav and kickers (weight 800, `letter-spacing .02em`, no case transform).
  - `--mono` = Fredoka, for headings (weight 600), the logo, questions, the keypad, big numbers and SVG text.
  - `--num` = Nunito with `tabular-nums`, for clocks, tables, stats and scores.
  - `em` in headings is upright and coloured. No italics for hints (v2.7 removed them).
  - **Do not** go back to Latin Modern / JuliaMono: the owner rejected that look.
- **Motifs:**
  - Section numbers: 1 arena, 2 games, 2.5 live duel (lobby A/B/C, rooms), 3 numbers/record, 4 boards, 5 chat, 6 account, 7 preferences. The Arena has a full-width "Live Duel" card (ONLINE · 2 DEVICES) under the main event. The admin portal uses §1 Players … §5 Audits with Lean type-signature headings (`players : List User`) and the same seaside tokens, pills and ✦.
  - Kept from the textbook base: numbered equations, booktabs tables, "Figure n" captions, ballot-box toggles (now rounded, teal).
- **Chat window exception:** `.irc` deliberately uses **classic Win9x/mIRC chrome in both themes**:
  - grey `#C0C0C0` bevels; title bar gradient `#000080 → #1084D0`; white log;
  - mIRC nick colours from `NICKC`; system lines green `#009300`; actions purple `#9C009C`; errors `#FC0000`.
  - A decorative menu bar (hidden under 640 px), a channel switchbar, and a nick list (on phones a "Nicks (n)" toggle shows it under the log).
- **Shape:** base radius 2 px, overridden by the friendly layer (16/12 px, pills); 18 px gutter; max width 1080 px. Tab bar under 760 px with 5 tabs.
- **Motion:** wrong-answer shake + `--bad` wash (not in Little Ones, which uses a gentle wobble); countdown; ink-coloured confetti; everything respects `prefers-reduced-motion`.
- **Little Ones layer (v2.5, `.lt*`, `.game.little`):** new tokens `--sun-deep` (day `#FFF3C4`, night `#3B3420`) and `--sun-ink` (day `#7A5200`, night `#FFE08A`) for the sunny card and tag. Full-screen `.lt` with a sun radial background. Answer buttons have 3 px teal borders, a 24 px radius and a 5 px ledge. Right = `--win` fill, wrong = wobble + 35 % opacity. Progress stars are CSS clip-path stars (not emoji), so they show even without an emoji font. Picture size comes from `--sz` on `.lt-scene` (count: `min(17vw,11vh)`; add: `min(14vw,9vh)`; more: `min(11.5vw,8vh)`; larger caps at ≥ 760 px). Animations (`lt-pop`, `lt-wobble`, `lt-hop`, `lt-breathe`) are cut by the global reduced-motion rule.
- **Logo (v2.6):** the mark is a ÷: an ink bar (`x124 y235 w264 h42 rx21` in a 512 box), a `--p1` dot above (`cy150 r46`) and a `--p2` dot below (`cy362`). The header and the admin draw it inline with classes `.mk-bar` / `.mk-a` / `.mk-b`, filled from tokens in CSS (so night mode recolours it; no `var()` in SVG attributes). The icon tile is sand `#FFF8EE` with a `#BFE6EA` scalloped sea (`M0 460`, 64 px scallops) that must stay below the pink dot. Never bring back the dark neon tile.
- **v2.6 review layer** (a CSS block before the reduced-motion rule): static tags at ≤ 520 px, `.hero .eqn` hidden below 640 px, `.flab`, `.acts-grid`, `.who .av svg`. `.lede` is left-aligned with `hyphens:manual` (justified text is banned at these widths).
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
- **Fonts (v2.7):** about 110 KB total, immutable cache: `nunito-latin-wght.woff2`, `nunito-latin-wght-italic.woff2` (`@fontsource-variable/nunito@5.2.7`) and `fredoka-latin-wght.woff2` (`@fontsource-variable/fredoka@5.2.10`). They're unmodified, so the original names are kept. Sources and licences are in `fonts/README.md`.
- **npm scripts:** `migrate`, `role`.
- **Local QA (session scratchpad, not in the repo):**
  - `qa/server.mjs` mounts `api/*.js` (including `audit-cron` with `CRON_SECRET=test-cron-secret`) and serves static files.
  - `qa/test2.mjs` holds the 61 checks; it creates `qa.*.<tag>@example.com` users, sets roles via SQL, and cleans up after itself.
  - `qa/shots4.mjs` takes the screenshots.
  - `qa/test3.mjs` holds the 49 live API checks. `qa/shots5.mjs` runs two browser contexts (desktop paper + phone blackboard) through a full private live game with a rematch.
  - `qa/test4.mjs` holds the 17 password-flow checks. `qa/shots6.mjs` takes the v2.4 design screenshots.
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
| **admin** (Imogen, id 71) | super_admin in Players → role, or `npm run role` (Imogen was created by a one-off script) | **While chat is off (v2.6): the Players tab only** (search, reset players' passwords). With chat on, everything below. Everything a player can do, plus an "Admin tools" button on Account, `@` in chat, and the `/admin` Players and Chat tabs: search players, reset **players'** passwords, delete messages, mute or unmute **players**. Can't see the activity log, flags, audits or player details. Can't act on admin or super_admin accounts (generic "can't be changed from here" / "can't mute this player"). Sees the super_admin as an ordinary player. Password resets she does force the player to choose a new one. Every action is logged and listed in each audit. |
| **super_admin** (the owner) | **only** `npm run role` (CLI) | Looks exactly like a player in the game and in chat. Types `/admin` while signed in to get everything: all players with true roles, role changes, password resets for anyone, mutes for anyone, removed-message text, the flag review queue, the full activity log with CSV export, audits (run, read, mark reviewed), and per-player histories. |
