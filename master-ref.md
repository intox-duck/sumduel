# Sum Duel: master reference

> Living architecture reference. Update this **before every push or major change**. If code and this file disagree, that is a bug.

Live: **https://sumduel.app** (`www.sumduel.app` 308-redirects to the apex; `sumduel.vercel.app` also serves it). Vercel project `sumduel`, team `james-projects-f6199c2a`. Repo: `github.com/intox-duck/sumduel`, branch `main`.

---

## Now (2026-11-13)

- **State: v3.0 on `main`** (pushed 2026-11-13; Vercel deploys it automatically). The last version live before it was v2.8.2.
  - The owner reviewed Grok's local v2.9/v2.10 work ("it's kind of shit") and asked for: the new games, but in a Brilliant.org style ("something less geared toward a 5 year old, but super easy to use"); the online games listed at the top, separately; at least five different maths games, including the climbing one, as live two-player games.
  - v3.0 replaces v2.9 and v2.10 (neither was ever deployed): seven live games that each play differently, one rewritten stylesheet, and an Arena that lists the online games first. Details in the v3.0 handoff entry.
- **No schema change.** `live_games.cfg` is jsonb and already holds `cfg.game`; the new games use the existing columns.
- **QA (local, in-memory PGlite; nothing touched the live database):** 82/82 live API checks (`qa/t-live.mjs`); 76/76 two-browser checks that play Climb, Target, Bigger, Missing Number and Duel through the UI, then quick match and the record (`qa/e2e-live.mjs`), re-run with player A in Seaside night and player B in ASCII night (50/50); 10/10 solo and guest flows (`qa/e2e-solo.mjs`); every view in 8 looks on phone and desktop with no console errors and no sideways overflow (`qa/views.mjs`); WCAG AA on every text/background token pair (`qa/contrast.cjs`). Live Truth or Lie and live Sprint weren't replayed end to end (their engines are unchanged); their API shapes were checked.
- **Next:** play the new games for real on two phones. The admin portal (`/admin`) keeps the v2 look (Nunito/Fredoka, its own CSS) and `og.png` still shows the v2 look; both could move to the v3 tokens.
- **Gotchas:**
  - `pkill -f server.mjs` / `pgrep -f server.mjs` inside a Bash call matches its own shell and kills it (exit 144). Kill by PID: `ps aux | grep "[s]erver\.mjs" | awk '{print $2}' | xargs -r kill`.
  - Playwright with `isMobile`: the sticky header and animated buttons (Little Ones' start) make `page.click` time out; click through `$eval(el => el.click())` there.

## Handoff log (newest first)

- **v3.0 (2026-11-13, `main`): seven live games, a Brilliant-style redesign, online games first.**
  - **Review of Grok's v2.9/v2.10** (both local, never deployed), and what happened to each part:
    - v2.9's four "new" live games were the Duel engine with blanks or a different clock: Missing Number (every sum blank), Mix-up (every other sum blank), "The Climb" (12 sums with every third blank, so no climbing at all) and "Target" (Sprint with a 45 s clock). **Kept:** Missing Number. **Rebuilt with real mechanics:** The Climb and Target. **Dropped:** Mix-up (it was Duel plus Missing Number).
    - v2.9's removal of same-device simultaneous play (split screen and the local Truth or Lie buzzer) is **kept**. The on-device Duel is take-turns, now called "Pass the Phone". Two players at once means two devices.
    - v2.10's "quieter Arena" was a ninth override layer: `box-shadow:none` everywhere, keyframes blanked to nothing, Blue/Pink ink changed in day mode only. Its `--faint` text failed WCAG AA at about 2.9:1. **Replaced** by the v3 stylesheet.
    - A Grok regression, fixed: `live_finish` logged timed games without `dnf`/`raw`/`idx`, so the admin activity log couldn't show a DNF.
  - **Seven live games**, all two-device, signed in and server-timed: Duel, The Climb, Truth or Lie, Sprint, Missing Number, Target, Bigger (rules in §2 Live games).
    - **The Climb:** a cliff of 12 ledges, easy at the bottom (4), then medium (5), then hard at the top (3). A right answer climbs a ledge and a wrong one slips you down one. Every ledge has 4 alternative sums, so a slip never replays a sum you've just seen. Both climbers are drawn on one cliff. First to the top wins, with no time penalty: the slip is the penalty.
    - **Target:** 5 number puzzles. Tap a number, a sign, then another number to combine them, and make the target. Each puzzle is built from a real solution that uses every tile with whole, positive steps, but any route counts. A skip costs 10 s and shows one way to do it.
    - **Bigger:** 15 pairs of sums; tap the bigger one. The pairs are close on purpose (within about 20 %) and never tie; hard mixes the operations. A wrong tap adds 3 s.
  - **Arena (`#/`):**
    - The hero, then **Play Online**: the seven live games, with a join-by-code box.
    - Then the daily gift banner.
    - Then **On This Device**: Climb the Coast, The Daily, Daily VS, Sprint, Pass the Phone, Little Ones.
    - Then the leaderboard, your numbers and the colour picker.
    - The cards are drawn from one catalogue in app.js (`LV_GAMES`, `GNAME`, `GINFO`, `GICON`, `SOLO`, `gcard()`, `renderHomeCards()`).
  - **Play Online (`#/live`):**
    - A game picker and a detail panel: how it works, a worked example and the options.
    - **Find an opponent** joins an open public game of that kind, or opens one and waits. **Make a game for a friend** creates one, public or private.
    - Rooms show the code big, with Share and Copy.
    - A code typed while signed out is kept through sign-in (`pendingJoin`).
  - **Design:** one new stylesheet (Plus Jakarta Sans, tactile tiles with a bottom lip, black primary buttons, initials for avatars, one colour per game). See §4.
  - **Bugs found and fixed by the v3 QA:**
    1. Confetti made mobile browsers double `innerHeight` until reload. The canvas was briefly a fixed box larger than the screen, and v3 had also dropped the `#fx` and `.toast` rules (restored).
    2. A display name with 9+ digits blocked that player from creating any live game ("Phone numbers aren't allowed"), because the default game name went through the chat filter.
    3. Long email addresses widened the Account page on phones.
    4. After a Target skip, the label already showed the next puzzle number.
    5. Bigger's previous right answer stayed green for 150 ms as the next pair appeared.
    6. **Deploy skew:** assets are stale-while-revalidate in the service worker, so a returning player's first visit after this deploy would have run the old cached app.js on the new index.html and crashed (an empty Arena: "Cannot read properties of null"). v3 loads `/app.js?v=3.0`; `qa/sw-upgrade.mjs` serves v2.8.2, lets its worker cache it, swaps in v3 on the same origin, and checks the first load (it fails without the query, passes with it).
  - Service worker `sd-v3.0`. Manifest colours `#F7F7F5`. No schema change.
- **v2.10 (2026-11-13, local, never deployed; superseded by v3.0): quieter Arena.** Same product, less of the nursery look. Nunito carries the headlines (Fredoka dropped from the shell). Sticker shadows are gone on every palette, including blue and pink. ASCII stays square and monospace. Not deployed.
- **v2.9 (2026-11-13, local, never deployed; superseded by v3.0, which keeps its same-device removal and Missing Number): lobby games, no same-device race.** A split screen shows the other player's answers, and one phone can't host two players fairly at once. Face to face is removed. Local Truth or Lie (the same-device buzzer) is removed; `#/tol` opens the live lobby with Truth or Lie selected. The on-device Duel is take-turns only (`mode: 'turns'`; a saved `split` is rewritten). Live games, all signed-in and two-device: Duel, The Climb (12 questions, every third sum blank, duel scoring; the solo trail stays, with "Race a friend"), Truth or Lie, Sprint, Missing Number, Target (45 s, goal of 12), Mix-up. No schema change. Service worker `sd-v2.9`. Not deployed.
- **v2.8.2 (2026-11-13, `main`): heading spacing.** Fredoka's kerning pulls a space and a following "V" together by 0.15 em (every other letter is within 0.02 em), so "Daily VS" showed as "DailyVS". The user-facing strings now use `Daily\u00A0VS` (`&nbsp;` in the card markup); a no-break space isn't kerned and also stops the title wrapping. Service worker `sd-v2.8.2`.
- **v2.8.1 (merged 2026-11-13 as `82c8886`, live): review fixes, palettes, title case.**
  - **Review fixes** (from a code review of PR #1 plus local QA):
    - The Climb, Truth levels: a third mistake on the **last** statement, then "keep going", crashed and locked the level (`G.qs[n]` undefined). Now it clears the level. The clock can't run out while an answer's feedback is showing, and Stop can't race a win that's being saved (`G.ending`).
    - Sharing a drawn live Truth or Lie (or Sprint) game threw. Fixed.
    - `adopt` (guest progress into an account) accepted any untouched wallet and was called on every sign-in. Now: only into an account made in the last 15 minutes whose wallet has never been written (`rev = 0`), so it's once only, and the client calls it only on sign-up (`j.created`).
    - Guest games were paid twice on sign-up (once into the guest wallet, which adopt carries over, then again when the battles synced). Battles now pay only if played since the account was made, and all in **one** wallet write (`awardBattles`), capped at `EARN_CAP`.
    - Daily VS: your own run was missing if you were slower than the 40 shown (now looked up separately). A failed prize payout no longer loses the first-race prize (the run is taken back out so a retry still counts as first). The race now uses the day the rival list was loaded for, not "today" again.
    - Live Truth or Lie: calls before the reveal are refused (150 ms margin for clock sync; the text still goes out 1.2 s early). A device's reaction time can undercut the server's measurement by at most `TOL_SLACK` 1.2 s (was 2.5 s), with a floor of 300 ms. The code comments now say plainly what this does and doesn't prevent.
    - The Climb: a level can't be finished in under 6 s (`CLIMB_MIN_MS`), and coins and chest hearts stop after 200 paying wins a UTC day (`CLIMB_CAP`, new columns `climb_day`/`climb_n`). Progress and stars never stop.
    - `api()` now keeps the server's error `code`, so "no hearts" opens the shop for signed-in players too. The hearts shop and level sheet cope with no wallet (offline) instead of throwing.
    - **No more runtime DDL:** `ensureSchema()` is gone from every request path. `api/_schema.js` only exports `V28`, applied by hand (§6).
    - Title case for every page, section, card and sheet title (owner rule). Aria labels and spoken text stay in sentence case.
  - **Palettes** ("Your Colours" on the Arena under the game cards, with a Day/Night switch; the same tiles in Account → Preferences): **Seaside** (the original, default), **Shades of Blue**, **Shades of Pink**, **ASCII Mode**. See §4 "Palettes".
  - Service worker `sd-v2.8.1`.


- **v2.8 (PR #1, merged 2026-11-13 as `3cac915`; schema applied by hand first): live game types, the Climb, coins and hearts, daily gift, Daily VS.** The owner asked (2026-11-12) for "live games of a variety of games, truth or lie on 2 devices… climb trail version, with lives given out as coins, be generous… a daily vs". Read as:
  - Live offers Duel, Truth or Lie and Sprint on two devices;
  - **The Climb**: a Wordscapes-style trail, 12 levels per area, a chest at each area's end;
  - **hearts** gate Climb levels and **coins** buy hearts and extra goes, both handed out generously;
  - **Daily VS**: a daily ghost race against today's players or three sea bots.

  Details are in §2 (Rewards, The Climb, Daily VS, Live Truth or Lie). Rules live in `api/_economy.js`, **mirrored in `app.js`** (keep them in step). There's a new function `api/rewards.js` (8 of 12 Hobby functions) and new tables `wallets` and `daily_vs`. No real money, no ads. Little Ones stays outside the economy, and Climb levels aren't written to the battle record.
- **v2.7:** Nunito + Fredoka fonts (self-hosted, OFL), original inline-SVG illustrations coloured by `.il-*` classes, a public home leaderboard (`#homeBoard`), and the players dashboard (`#/players`, signed-in only).
  - The owner's "all users reports" was read as every player's *game report*: display names and stats only (never emails, roles, IPs or audits), with the hidden super_admin shown as an ordinary player.
  - Chart colours validated: wins `#00879B`/`#21A2B5`, losses `#D6336C`/`#D94C82`, draws `#868CA3`/`#7D86A8`.
- **v2.6:** chat switched off (`api/_features.js` `CHAT_ENABLED=false` + `CHAT_ON=false` in `app.js`; re-enable steps in §2 Chat). Adversarial design review in Claude Design: https://claude.ai/artifact/MfqwNUcqKa2g94aQSoNdUc (ten findings, all fixed). New seaside ÷ logo.
- **v2.5:** Little Ones, a client-only picture level for 4-year-olds (§2).
- **v2.4:** forced password change, Account → Change password, the "seaside" friendly redesign.
  - **Imogen** (`imogen.o.king@gmail.com`, id 71, the owner's 9-year-old daughter) is `admin`, created by a one-off script; she has since set her own password.
  - **Requested but deliberately NOT built:**
    1. Imogen as super_admin: that role includes the safeguarding queue, every child's activity and IP history, and account takeover.
    2. A decoy reset that pretends to change the owner's password.
    3. Changing the owner's password to a generated string, which risked locking them out.

    Admins get the generic "This account can't be changed from here."
- **v2.3:** Live Duel on separate devices (polling, server-timed, private games with passwords, rematch). Built on the existing Neon database (the owner said "Use it").
- **v2.2:** roles stored in Neon instead of Google sign-in (the owner found OAuth setup "too hardcore"), the activity log, chat with safeguarding filters, the flag queue and daily audits.
  - The super_admin role sits on the **existing row id 7** (`james.s.king@gmail.com`, created 2026-11-08 09:01 UTC), not on an email string, so re-registering the email can't take it. Sign-up has no email confirmation.
  - `CRON_SECRET` is set (sensitive, production + preview). The v2.1 `ADMIN_EMAILS` env var is unused and safe to delete in the Vercel dashboard.
- **Neon provenance:** the Marketplace integration `icfg_EyO6QHtjMfDAPR08XyR45pyR` (free plan) was installed 2026-04-22. The `sumduel-db` database was added 2026-11-07 23:18 UTC by a Claude session using the **Vercel CLI**. The Vercel MCP can't create Neon stores, but `vercel integration add neon` can.
- **Next ideas (not built):** alerts when a wellbeing or personal-info flag fires (needs an email provider key); friend codes; achievements; server-side Daily verification.
- **Gotchas:**
  - Vercel CLI: run `vercel whoami` first (device login hangs); prefer the MCP tools.
  - `pkill -f` inside a Bash call can kill its own shell; kill by PID.
  - The WSL clock runs about 3 s behind Neon: time windows compared with `activity_log.at` must use the DB `now()`.
  - Emails are lowercased on sign-up.
  - The Write tool can turn `\u` escapes into literal characters; build regex lines through Python.
  - GitHub release downloads gave 504 here (raw.githubusercontent worked); jsDelivr refuses repos over 50 MB.

---

## 1. Architecture & module layout

A static single-page app plus eight Vercel serverless functions (Hobby limit 12; `_`-prefixed files are shared modules, not functions). There's **no build step** and no framework.

| Path | Role |
|---|---|
| `index.html` | Markup for every view plus **all CSS inline**: the v3 design system, one stylesheet organised by component (§4), plus the kept Little Ones and chat blocks. Preloads Plus Jakarta Sans. Loads `app.js` (defer). |
| `app.js` | The whole player client: router, the **v3 game catalogue** (names, one-liners, icons, colours, penalties) and the Arena cards, the pad engine, the Climb trail, Little Ones, Daily VS, live games (lobby, room, and the Climb, Target and Bigger engines), auth, sync, record, boards, chat (off), sound, speech, confetti. ES5-style IIFE. |
| `admin.html` + `admin-portal.js` | The admin portal at `/admin` (clean URL). Inline CSS, no inline JS (strict CSP). Shows a plain 404 page to anyone who isn't an admin. |
| `sw.js` | Service worker `sd-v3.0`: precaches the shell (`/`, `/app.js?v=3.0`, icon, manifest) and Plus Jakarta Sans. **v3: index.html loads `/app.js?v=<version>`; bump it together with `VERSION`.** Assets are stale-while-revalidate, so without the query a returning player's first visit after a deploy got the new index.html with the old cached app.js; navigations network-first with **only `/` cached**; never caches `/api/*` or `/admin*`. Bump `VERSION` when shell files change. |
| `fonts/` | Self-hosted woff2 files and their licences (`fonts/README.md`): Plus Jakarta Sans for the player app; Nunito and Fredoka, still used by `admin.html`. |
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
| `api/live.js` | Live games API: Duel, The Climb, Truth or Lie, Sprint, Missing Number, Target, Bigger (`GAMES`, `TIMED`, `PEN`, `FIXED_N`). Lobby, create, join (with password), ready, progress (with the Climb's ordering rule), call (Truth or Lie), leave, claim, rematch. |
| `api/rewards.js` | v2.8: wallet (coins + hearts), daily gift, buying hearts, Climb start/continue/finish, Daily VS board (public) and finish, guest `adopt`. |
| `api/_economy.js` | v2.8 rules: `ECON` numbers, `battleCoins`, `climbReward`, heart regen, `mutate` (optimistic lock on `rev`), `awardBattle`, the Daily VS bots (`botRun`). **Mirrored in `app.js`.** |
| `api/_schema.js` | The v2.8 tables (`V28`), applied by hand (§6). No request path runs DDL: v2.8.1 removed `ensureSchema()`. `scripts/migrate.js` also applies `V28`. |
| `api/_questions.js` | Server copy of `makeQuestions`, `makeTol`, `rng`, `hashStr` and `RANGES` (**keep these identical to `app.js`**), plus the server-only v3 generators: `makeClimb` (12 ledges × 4 sums, `CLIMB_BANDS`), `makeTargets` (+ `combine`), `makeBigger`, and `makeLiveQuestions(game, n, ops, level, seed)`. |
| `api/audit-cron.js` | Vercel cron target. Checks `Authorization: Bearer $CRON_SECRET`, then calls `runAudit`. |
| `scripts/migrate.js` | Idempotent schema (`npm run migrate`). |
| `scripts/role.js` | `npm run role -- <email> <player|admin|super_admin>`. **The only way to create a super_admin.** Logs `role_set_cli`. |
| `vercel.json` | Clean URLs, `lhr1`, headers (strict CSP + noindex + no-store on `/admin*`, immutable `/fonts/*`), and `crons: [{ path: /api/audit-cron, schedule: "0 7 * * *" }]`. |

### Client views (hash router)
`#/` Arena (Play Online first, then On This Device) · `#/duel` Pass the Phone (take-turns Duel setup) · `#/tol` opens Play Online with Truth or Lie picked · `#/climb` Climb the Coast (the solo trail, plus "Race a friend") · `#/vs` Daily VS · `#/live` Play Online (game picker and detail, join by code, open games) and `#/live/CODE` (a room; signed out, the code is kept through sign-in) · `#/record` · `#/boards` · `#/players` (signed-in only) · `#/chat` (off since v2.6; it falls through to home) · `#/account`. The game screens aren't routed. `route()` calls `chatStop()`, `liveStop()`, `climbStop()` and `closeSheet()` on every navigation, so polling only runs while that view is open. Leaving a live game by navigating away doesn't forfeit, but after 25 s of silence the opponent can claim the win.

## 2. Code & data workflow

### The Arena (`#/`, v3)
- **Hero** (`.hero`): kicker, headline, lede, two buttons (Play a friend online → `#/live`; Climb the coast → `#/climb`) and `.hero-demo`, an HTML mock of a live game card. Phones hide the demo and the buttons so Play Online starts on the first screen.
- **Play Online** (`#online`): a join-by-code form (`#homeJoin`: 5 characters; signed out it keeps the code in `pendingJoin` and opens Account) and `#onlineGames`, the seven live games drawn by `renderHomeCards()` from `GINFO` (The Climb is the wide featured card with a mini cliff). A card (`data-live`) sets `LCFG.game` and opens `#/live` with that game picked.
- **Gift banner** (`#giftBar`) when the daily gift is ready, then **On This Device** (`#soloGames`, from `SOLO`: `data-go` = climb, daily, vs, sprint, duel, little), then the leaderboard (`#homeBoard`), your numbers (`#homeStats`, when this device has battles) and the colour picker (`#palPick`).
- Clicks are delegated once on `#v-home`. The meta line of three solo cards updates live: `#climbTag` (level and stars), `#dailyTag` and `#vsTag` (Today / Done ✓ / Raced ✓).
- **Avatars** (`avatar(name, size)`): the first letter of the name on one of seven game colours, chosen by a hash of the name.

### Games, battle record shape, offline-first sync
Unchanged from v2, with the live games' names added in v3. Solo games, the take-turns Duel and the live clients live in `app.js`. Battles are written to `sd_battles` + `sd_pending` and flushed in batches of 200, deduped on `(user_id, client_id)`. Guest battles migrate to the account on sign-in. Shape:
```js
{ cid, at, game: 'duel'|'tol'|'sprint'|'daily'|'climb'|'missing'|'target'|'bigger', mode?: 'turns'|'live'|'ghost', cfg: { ops, level, n? }, winner?: 0|1|-1, day?, practice?,
  players: [{ name, time?, raw?, wrong, score?, splits?, bestStreak?, wrongBy?, avgRt? }] }   // account holder = player 0
```

### Rewards (v2.8): coins, hearts, daily gift
- **Authority:** signed in, `/api/rewards` owns the wallet; the client renders what it returns (`setWallet`). Guests: `localRewards(action, body)` in `app.js` runs the same rules on `localStorage sd_wallet_local` and returns the same shapes, so every caller just uses `rewards(action, body)`.
- **Header purse** (`#purse`, coins + hearts, links to the Climb); it bumps when a number changes. The phone header hides the account name under 460 px to make room.
- **Paying for games:** `payBattle(b)` shows "+N coins" on every results screen. Signed in, `/api/battles` pays newly saved battles from the last 24 h (`battleCoins`) and `/api/live` pays both players when it records a live game; guests are paid locally.
- **Daily gift:** a banner on the Arena when it's ready (`#giftBar`) and a button on the Climb bar; a sheet with the 7-day calendar and a chest that opens.
- **Sheets:** `openSheet(html)` / `closeSheet()`: one modal at a time, bottom sheet on phones, centred card from 640 px; Esc or the backdrop closes it.

### Climb the Coast: the solo trail (v2.8, `#/climb`; the live race is "The Climb" in Live games)
- **Levels are generated from their number** (`climbDef(L)`): area = ⌊(L−1)/12⌋, position p = (L−1) mod 12 picks the kind from `KINDS` = race, truth, missing, race, target, mixed, race, truth, missing, target, race, **boss**. Areas (`AREAS`): Rock Pools (easy +, then + −), The Harbour (easy + −, then ×), Sand Dunes (easy × ÷, then all), The Pier (medium + −), Cliff Path (medium × ÷), Lighthouse Point (medium all), Starry Sky (hard + −), Moon Beach (hard × ÷ then all); after level 96, endless "Summit n" areas (hard, all, slowly quicker). Clocks come from a per-area seconds-per-question (`tpq`), 2 % quicker per level within an area.
- **Kinds:** race (n sums before the clock; +3 s per wrong), truth (8 statements, 2 mistakes allowed; uses its own `truthHalf()` screen), missing (`7 × ? = 42`, via `toMissing`), target (45 s, a goal of correct answers; 2★ = goal+3, 3★ = goal+6; ends early at 3★), mixed (every other sum has a missing number), boss (12 sums, every op of the area, opens the chest).
- **Stars:** timed kinds: ≥ 40 % of the clock left = 3★, ≥ 20 % = 2★, else 1★. Truth: 0/1/2 mistakes = 3/2/1★. Any paid "keep going" caps the level at 1★.
- **Hearts:** `climbStart` takes a heart up front and returns a run id; `climbFinish` (won) gives it back with the coins. Quitting or closing the app keeps the heart spent (so it can't be dodged). Out of time or mistakes: "Keep going" (+20 s, +15 s on target, or one more mistake) for 25 coins, up to 3 times.
- **Trail map:** areas stacked bottom-up in a 560 px column; nodes on a sine path (`nodeX`, `nodeY`), a Catmull-Rom SVG path per area with `vector-effect: non-scaling-stroke`; scenery from `DECOR`/`SCENE` (inline SVG at the edges, `.il-*` classes). The view scrolls to the current node, where your blob avatar bobs. Locked areas are greyed. Sticky `.climb-bar` with hearts, next-heart countdown, coins, stars, gift and shop.

### Daily VS (v2.8, `#/vs`)
- 15 questions a day from `hashStr('sumduel-vs-' + day)` (medium, all four ops), the same for everyone. Rivals: anyone who has already raced today (`daily_vs` rows, public like the boards: names, times, splits) or three bots: Wobble the Jellyfish (≈ 5.2 s/q, 2 wrong), Captain Crab (≈ 3.4 s/q, 1 wrong), Sid the Shark (≈ 2.1 s/q, 0 wrong). Bot runs are fixed per day (`botRun`, mirrored on the server so it can check the result).
- The race reuses the pad engine; the rival's ghost moves along the live-style strip at their real per-question pace (raw time; their penalties are added at the end, like yours). Results reuse the Duel results screen (both players' splits on the chart) and record a battle `{ game:'duel', mode:'ghost' }`.
- **First race of the day counts:** it stores your run as a ghost for others (signed in only) and pays the prize, win or lose. Later races are rematches (10 coins for a win).

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
| Games | `battle_saved` (summary: game, winner, opponent, times or scores), `score_posted`, v2.8: `climb_finish`, `vs_finish`, `gift_claimed`, `coins_spent`, `progress_adopted` (all in the "Games & scores" group) |
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

### Live Truth or Lie (v2.8)
- Everything follows from `start_at` and the two players' calls (`tolTimeline()` in `api/live.js`): statement k is revealed at R_k (R_0 = `start_at`); the round closes when both have called, or at R_k + 6 s; R_{k+1} = round end + 1.8 s. The quickest right call scores (device-measured reaction time, clamped to the server clock: never more than 2.5 s faster than the call's arrival, never slower than it). A wrong call just means you can't score that round. First to 7; after 25 statements the higher score wins (a tie is a draw).
- Calls are stored as `host_extra.calls` / `guest_extra.calls` (`{"k": {s, rt, at}}`); each player only writes their own column, with a conditional jsonb update so a double tap can't call twice.
- **No answers leave the server early:** the statement text is sent 1.2 s before its reveal (so both devices show it on time) and its truth only after the round. The room polls every 0.5 s during play.
- Client: `liveTolStart`, a 50 ms frame loop (`liveTolFrame`) that reveals on server time and runs the call-window bar, `liveTolTick` for round results ("+1 for you! Quicker by 0.21 s"), `liveTolCall`. Keys: A/← true, S/→ lie.

### Live games (`#/live`, `api/live.js`, `live_games`)
- **The seven games** (`cfg.game`). The catalogue is `LV_GAMES`/`GNAME`/`GINFO`/`GICON` in app.js; the rules are in api/live.js.
  - "Timed" games are a race to the end of the same set, on separate clocks. Fastest time wins, with a penalty per wrong answer (`PEN`, mirrored in app.js): Duel 3 s, Missing Number 3 s, Bigger 3 s, Target 10 s per skip, The Climb 0.
  - Sprint and Truth or Lie are scored.

  | Game | Length | How it's played | Decided by |
  |---|---|---|---|
  | Duel | 5/10/15/20 sums | Type the answer. A wrong answer keeps you on the same sum. | Fastest time, +3 s per wrong |
  | The Climb | 12 ledges (`CLIMB_BANDS`: 4 easy, 5 medium, 3 hard), 4 sums per ledge (`questions[ledge][alt]`) | Right = up a ledge. Wrong = down a ledge, and both ledges show a fresh sum next time (`G.visits`). Both climbers are on one cliff. | First to the top (no penalty) |
  | Truth or Lie | up to 25 statements | Call true or lie once per round; the server judges the round (see Live Truth or Lie). | First to 7 |
  | Sprint | 60 s | Type answers. | Most correct; fewer wrong breaks a tie |
  | Missing Number | 5/10/15/20 sums | Every sum has a gap (`toMissing`): `7 × ? = 42`. | Fastest time, +3 s per wrong |
  | Target | 5 puzzles (`makeTargets`: easy 3 tiles 1–9 for 6–30; medium 4 tiles 1–10 for 10–60; hard 4 tiles 2–12, half the time one of 15/20/25, for 20–150) | Tap a number, a sign, then another number; the result replaces them and stays selected. Make the target by any route, without needing every tile. − and ÷ put the bigger number first. Undo, Start again, Skip (+10 s, shows one way). | Fastest time, +10 s per skip |
  | Bigger | 15 pairs (`makeBigger`: within about 20 %, never a tie; hard mixes operations across the two sides) | Tap the bigger sum. Both values show after each tap. | Fastest time, +3 s per wrong tap |

- **Lobby (`#/live`):** a radio group of game tiles (`.gpick`; arrow keys move the choice) and a detail panel (`paintDetail`).
  - The panel shows how it works (`GHOW`), a worked example (`GEX`), Operations, Difficulty (not for The Climb, which ramps from easy to hard) and Questions (Duel and Missing Number only).
  - **Find an opponent** (`quickMatch`) joins the newest open public game of that kind that isn't mine. If I already have one open it goes back to it; otherwise it creates a public game and waits in its room.
  - **Make a game for a friend** (`createGame`) can be private, with a password of 3–50 characters (scrypt-hashed).
  - Below: Join With a Code (5 characters) and Open Games (polled every 3 s). The settings persist in localStorage `sd_live_cfg`.
  - The lobby has no name field. The server names a game "<display name>’s game" and only screens a typed-in name with the chat filter: the display name is already public, and screening it blocked names with 9+ digits.
  - Signed out, the lobby still shows the picker and the detail panel, with "Sign in to play". A code typed on the Arena, or opened as `#/live/CODE`, while signed out is kept in `pendingJoin` and opened straight after sign-in.
  - One active game per player: creating or joining leaves your other lobby.
- **Room (`#/live/CODE`):** polled every 1.3 s.
  - It shows the game icon and name. While the game is open, the code is shown big with "Share the link" and "Copy the code".
  - Both player cards show ready states (**you are always P1 colours, your opponent P2, on every device**). When the room is full it shows the rules, the example and "I'm ready".
  - Statuses: `open` → `full` → `playing` → `done`, or `cancelled` / `abandoned`.
  - Housekeeping on each lobby poll: a lobby whose host has been silent for 60 s is abandoned; a silent guest is dropped back to `open`; a game where both players have been silent for 5 min is abandoned.
- **Start:** when both are ready, the server generates seeded questions (`makeLiveQuestions`) and sets `start_at = now() + 5 s`.
  - Questions, with answers, are only sent from 3.5 s before GO. Truth or Lie never sends answers early.
  - Each client estimates its clock offset from the lowest-latency poll and counts down on server time. Late arrivals start with their elapsed time already counted.
- **Play (client):** `liveStartGame` dispatches:
  - Duel, Missing Number, Sprint and The Climb use the pad engine (`makeHalf`, `press`, `finish`). The Climb adds the cliff (`cliffHtml`, `cliffPaint`), the slip in `press` and its question lookup (`curQ`).
  - Target (`liveTargetStart`, `tg*`) and Bigger (`liveBiggerStart`, `bg*`) have their own screens. Truth or Lie is `liveTolStart`.
  - Shared pieces: `liveSetup`, `liveChrome` (Quit plus the opponent strip), `liveShow`, `liveCountdown`, `liveTick` (opponent progress and the claim-win button) and `liveReport` (queued, one in flight, retried).
  - Keys: digits, Backspace and Esc on the pad. Target: 1–9 pick a tile, + − * x / pick a sign, Backspace undoes, Esc starts again. Bigger: ← A 1 for left, → L 2 for right. Truth or Lie: A or ← for true, S or → for lie.
  - Games that show feedback after the last answer (Target, Bigger) call `finish(0, at)` with the time of that answer, so the feedback delay isn't counted.
- **Progress (server):** `progress {idx, wrong, final?, raw?, extra?}`. A finished player's progress is ignored. The pace cap: moves can't run faster than 2.5 a second, plus 3.
  - Duel, Missing Number, Target and Bigger: idx and wrong only move forward, and idx ≥ n finishes. In Target, idx counts puzzles done and wrong counts skips; in Bigger, idx counts pairs answered.
  - The Climb: idx is the ledge and can go down. A report counts only if neither `wrong` nor `idx + 2·wrong` has gone down (every move adds at least 1 to `idx + 2·wrong`) and `idx + wrong` fits the pace cap. idx = 12 finishes.
  - Sprint: idx is capped at 150 and by the pace; `final` is only accepted from 57 s.
- **Result (decided on the server, once, through a conditional update):**
  - **Time (timed games):** the device time is used if it's within −5 s / +1 s of the server-measured time, otherwise the server time is used; then wrong × `PEN` is added.
  - **Winner:** both finished → the lower time (a gap under 5 ms is a draw); one finished → that player; timeout → whoever got further (idx).
  - **Timeouts:** The Climb 240 s, Target max(180, n×45) s, Bigger max(120, n×12) s, Duel and Missing Number max(120, n×20) s, Sprint 75 s, Truth or Lie about 3.5 min.
  - **Forfeits:** `leave` mid-game is a forfeit, and so is `claim` after 25 s of opponent silence.
  - Each player gets a `battles` row from their own perspective (`cid live-<id>`, `mode:'live'`), so the client's re-save dedupes. Coins are paid then (`battleCoins`: 15, plus 15 for a win).
- **Rematch:** either player creates a new game with the same settings, name and password, with the other player as `invited_id`. The old game's `rematch_code` shows the opponent a "wants a rematch → Join" bar on their results screen. The invited player skips the password.
- **Logging:** `live_create`, `live_join`, `live_join_failed` (10 per 10 min → 429), `live_start`, `live_finish` and `live_leave`. `live_finish` logs time, raw, wrong, idx and dnf for timed games, and score and wrong for scored ones. The admin log labels all seven games (`GN` and `TIMED` in admin-portal.js).
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
- **v2.8 tables:** `wallets(user_id pk, coins, lives, lives_at, climb_level, climb_stars jsonb, gift_day text, gift_streak, run jsonb, earn_day text, earn_n, rev, updated_at)`, `daily_vs(day text, user_id, time, raw, wrong, splits jsonb, rival, won, created_at, pk(day,user_id))`.
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
- **v2.6 review** (ten findings, all fixed; full list on the Claude Design canvas in the handoff log): the v1 neon logo and `#050B18` manifest colours replaced by the seaside mark and `#FFF8EE`; a PNG icon set (iOS ignores SVG touch icons) with a safe-zone maskable icon; `og.png` and new share copy; static tags at ≤ 520 px; the phone hero equations hidden; left-aligned prose (justified text made rivers); a person glyph for the signed-out avatar; tidier account labels and kicker numbers.
- **Little Ones (v2.5):** the owner asked for a level for 4-year-olds. The design rules follow from what that age can do: they can't read (so a voice and pictures), they can't use a keypad (so 3 huge buttons, at least 88 px tall), they shouldn't be timed or penalised (so no clock, a soft wrong-answer sound, and a count-along instead of a fail), and they love collecting things (so stars). It's kept out of the battle record so it doesn't inflate the stats or need an account.
- **v2.1 service worker fix:** only `/` is cached, so other pages can't overwrite the shell.
- **v2.8 design decisions:**
  - *Live Truth or Lie is judged per round, not as a buzzer race.* With 0.5–1 s polling, a first-tap-wins buzzer would hand rounds to whoever had the better network. Revealing on server time and comparing on-device reaction times is fair on any connection, and one call per round keeps it a guessing game with a cost.
  - *A heart is taken at the start of a level and refunded on a win* (the Candy Crush model), so closing the app mid-level can't dodge losing one.
  - *Server-owned wallet for accounts, local rules for guests:* accounts sync across devices and can't be edited from the browser; guests still get the whole game, and their progress moves over once, into a new account only.
  - *No DDL in the functions (v2.8.1):* the PR first created its tables from request paths (`ensureSchema()`). The review removed that, because schema changes are applied by hand after a live check (owner rule). The v2.8 tables went in by hand on 2026-11-13.
  - *Generosity is in the numbers, not the rules:* fast heart refills, cheap hearts, payouts on every game and a prize for losing your first Daily VS. Change `ECON` (both copies) to tune it.

- **v3 design decisions:**
  - *Seven different games, not seven skins.* The owner asked for "at least 5 different math/arithmetic type games". Each live game now trains something different: speed (Duel, Sprint), judgement (Truth or Lie), inverse operations (Missing Number), comparison and estimation (Bigger), reasoning with operations (Target), and a race with stakes (The Climb, where a mistake costs ground rather than seconds).
  - *The Climb slips instead of adding seconds.* Sliding down a ledge is visible to both players and turns accuracy into position. Because the ledge can go down, the server orders reports by `idx + 2·wrong` instead of "idx only moves forward".
  - *Target accepts any route.* Puzzles are built from an all-tile solution, so every one can be done, but children find other routes, and insisting on every tile would mark right answers wrong. − and ÷ take the bigger number first, so tap order doesn't matter.
  - *One tap to a game.* "Find an opponent" joins someone waiting for the same game, or waits for you. "Make a game for a friend" (with a code, and optionally a password) is one tap too. The lobby lost its name field: fewer steps, and the default name is the display name, which is already public.
  - *Online games first,* as their own section with a join box (owner request). The solo games follow as "On This Device".
  - *Brilliant-style, not Brilliant's brand.* The inspiration is the approach: a clean canvas, heavy type, tactile answer tiles, rules with a worked example. Colours, logo, font and icons are Sum Duel's own. Nothing copies Brilliant's name, logo, illustrations or typeface.
  - *Initials and flat geometric icons* replace the sea-creature avatars and card illustrations, because the owner wanted it "less geared toward a 5 year old". The Climb trail keeps its seaside scenery as the one playful world.

## 4. Styling & design system
- **v3 (2026-11-13): one stylesheet, written once.** The owner asked for a Brilliant.org style, "less geared toward a 5 year old, but super easy to use".
  - v3 replaced the eight v2 override layers (the textbook base, the v2.4 friendly layer, the v2.6 review, v2.7, v2.8, the v2.8.1 palettes and Grok's v2.10) with one stylesheet inline in `index.html`, organised by component.
  - Two blocks are kept as they were: Little Ones (`.lt*`) and the switched-off chat window (`.irc*`).
- **Audience:** the owner's daughter (9, reasoning at about 11), her friends, and the adults who play them. Keep wording short and plain. Never put her name or home town in public page text. Little Ones (ages 4–6) keeps its own big, voiced design.
- **The look:**
  - an off-white page with white cards and solid hairline borders;
  - heavy near-black headings with tight tracking;
  - black primary buttons and a blue selection colour;
  - one colour per player and one per game;
  - controls that press down when tapped.
- **Type:** Plus Jakarta Sans, self-hosted variable (200–800, SIL OFL), `fonts/plus-jakarta-sans-latin-wght.woff2`.
  - The old token names are kept as roles and all point at it: `--serif` body, `--caps` labels and buttons, `--mono` headings, questions and numbers, `--num` tabular numbers, `--sans`.
  - Headings (`h1.display`, `h2.title`, `.verdict`, `.gtx b`) are 800 with −0.035 to −0.05 em tracking. Body text is 500, 16 px, line-height 1.55.
  - Numbers that change (clocks, scores, codes) use `font-variant-numeric: tabular-nums`.
  - Kickers are small 800 labels in `--muted`: title case, and no section numbers since v3. No italics.
  - Strings still use `Daily VS` (the v2.8.2 fix for Fredoka's kerning). It's harmless with the new font and stops the title wrapping.
- **Tactile controls:**
  - Which: cards (`.gcard`, `.gpick`, `.pal`), buttons (`.btn`, `.chipbtn`), keys (`.pad button`) and answer tiles (`.ops button`, `.tg-tile`, `.tg-ops button`, `.bg-c`, `.tol-btns button`).
  - All have a 1.5–2 px border and a solid bottom lip, `box-shadow: 0 Npx 0 var(--lip)`. `:active` moves them down by N px and drops the lip.
  - States: selected = a `--sel` border, `--sel-bg` fill and `--sel` lip; right = `--win`/`--win-bg`; wrong = `--bad`/`--bad-bg`.
- **Buttons:**
  - `.btn` is white with a lip. `.btn.primary` (and the old `.btn.duo`) is black (`--ink`) with `--bg` text. `.btn.ghost` is text only. `.btn.lg` is 54 px tall.
  - `.seg` is a grey track with the chosen item as a white pill (`--seg-on`).
  - `.toggle` is a switch, green when on.
- **Tokens, Seaside day (the default):**
  - Surfaces: `--bg #F7F7F5`, `--surface #FFFFFF`, `--surface2 #F2F2EF`.
  - Text: `--ink #18181B`, `--ink2 #3F3F46`, `--muted #52525B`, `--faint #6B6B75`.
  - Lines and lips: `--line #E4E4DF`, `--line2 #D2D2CB`, `--lip #C8C8C0`, `--ink-lip #000`.
  - Players: `--p1 #0B7C8A` (you, teal) and `--p2 #D6336C` (the other player, raspberry).
  - States: `--sel #1A5BE0` on `--sel-bg #EAF1FF`, `--win #157A32` on `--win-bg #E4F4E8`, `--bad #C02626` on `--bad-bg #FDECEC`, `--sun #F2B100`, `--on-accent #FFF`.
- **Tokens, Seaside night:** `--bg #0F1115`, `--surface #171A20`, `--ink #F3F4F6`, `--p1 #3CC6D6`, `--p2 #FF7DA8`, `--sel #6EA1FF`, `--on-accent #0F1115`, dark lips (`--lip #07080A`). The `theme-color` meta follows `--bg` (app.js `applyTheme`).
- **Game colours** (icon tiles, with a white glyph at 3:1 or better):
  - `--g-duel` teal, `--g-climb` green, `--g-tol` violet, `--g-sprint` orange, `--g-missing` blue, `--g-target` red, `--g-bigger` grape, `--g-daily` red-orange, `--g-vs` indigo, `--g-little` amber; night has brighter twins.
  - Avatars use the first seven (`.ava.av0`–`av6`), chosen by a hash of the name, never by rank.
  - The cliff uses `--cl1/--cl2/--cl3` for easy, medium and hard.
- **Icons:** `GICON` in app.js, 48×48 inline SVG drawn in `currentColor` on a `.gicon` tile (`--gc`). Every icon also carries `data-ascii` for ASCII mode.
- **Layout:**
  - Max width 1120 px, 24 px gutters (16 px on phones), a 16 px card radius and 12 px for controls.
  - Arena grids: `.gl.four` for Play Online (4 columns from 1000 px, where The Climb card spans 2; 2 columns from 640 px; 1 column on phones, where cards turn horizontal with the icon on the left) and `.gl.three` for On This Device.
  - Phones get a compact hero (no illustration, no buttons), so Play Online starts on the first screen.
  - Under 760 px there's a tab bar with 5 tabs. The header is sticky, with a translucent blur.
- **Game screen:**
  - `.solo` content is centred, at most 560 px wide.
  - The top row is the Quit chip and the opponent strip (`.lv-opp`). Then the `.hud` (name in the player colour, progress, clock) and a 10 px rounded progress `.bar`.
  - The question is 800 weight. The answer box has a 3 px border in the player colour: dashed grey when empty, green when right. Below it, a 3×4 keypad of tactile keys.
  - A wrong answer shakes, washes the screen red and floats "+N s" up.
  - The Climb adds the cliff (`.cliff`, `.cl-track`, `.cl-dot.me`/`.opp`, the flag). Target uses `.tg-*` and Bigger `.bg-*`.
- **Hero illustration:** `.hero-demo`, an HTML mock of a live game card (progress bars, 7 × 8 = 56, keys) on three flat shapes, tilted −2°. ASCII mode shows the text art `pre.hero-asc` instead.
- **Palettes (v2.8.1, retuned in v3):** `html[data-palette]` = none (Seaside) | `blue` | `pink` | `ascii`, crossed with `html[data-theme]` = `paper` | `night`.
  - They're stored in localStorage `sumduel.palette` and applied before the first paint by the inline `<head>` script. Keep its list in step with `PALETTES` in app.js.
  - **Rule:** every token a palette changes is set in **both** its day and night blocks. A palette's day block has the same specificity as the Seaside night block and comes later, so a token missing from a night block leaks the day value into night mode.
  - **Blue:** day `--bg #F3F7FD`, `--ink #0F1A33`, `--p1 #0A6EB4`, `--p2 #3B4FD8`; night `--bg #0A1426`, `--p1 #4FC3F7`, `--p2 #9DA8FF`.
  - **Pink:** day `--bg #FFF5F9`, `--ink #2A0F1F`, `--p1 #A3167F`, `--p2 #D02E6A`, with `--sel` = `--p1`; night `--bg #1D0E17`, `--p1 #F27BD0`, `--p2 #FF9DB8`.
  - Blue and Pink keep the meaning colours (coins, hearts, wins), the game colours and the chart colours.
  - **ASCII, colours:** night is green phosphor (`--bg #050A06`, `--ink #7DFF9A`, players cyan `#5FD7FF` and amber `#FFAF00`); day is a line-printer page (`--bg #F6F5EE`, `--ink #111`, blue `#005F87` and orange `#AF5F00`). Both player pairs differ on the blue–orange axis, so they stay apart for every kind of colour blindness.
  - **ASCII, shapes:** the system monospace font; `--r 0`; no shadows, lips or press movement; dashed cards; `[ bracketed ]` buttons; a blinking `_` after the headline (off under reduced motion); icons as `data-ascii` text in a 1 px box; avatars as dashed boxes; inline-SVG scenery as wireframes; a "DEL" key.
  - The picker tiles (`.pal`, `role=radio`, arrow keys move the choice) draw their swatches from per-tile `--pv-*` variables, so each tile shows its own palette whichever is active. On the Account page they sit 2 across.
- **Contrast:** checked by `qa/contrast.cjs` in all 8 looks. Every text/background token pair passes WCAG AA: ink, muted and faint on bg, surface and surface2; p1, p2, sel, win and bad on their backgrounds; bg on ink. White glyphs pass 3:1 on every game colour, and on-accent passes 3:1 on p1 and p2.
- **Chart colours** (validated in v2.7, unchanged): wins `#00879B`/`#21A2B5`, losses `#D6336C`/`#D94C82`, draws `#868CA3`/`#7D86A8` (day/night).
- **Logo (v2.6):** the ÷ mark.
  - An ink bar (`x124 y235 w264 h42 rx21` in a 512 box), a `--p1` dot above (`cy150 r46`) and a `--p2` dot below (`cy362`), drawn inline with `.mk-bar`/`.mk-a`/`.mk-b`. They're filled from tokens in CSS, so night mode recolours them.
  - The icon tile is sand `#FFF8EE` with a `#BFE6EA` scalloped sea. Never bring back the dark neon tile.
- **The Climb trail** keeps its seaside world: area sky gradients (`.t-*` via `--a1/--a2`) and inline-SVG scenery (`DECOR`/`SCENE`, coloured by `.il-*`). Its chrome is restyled: tactile nodes, a sticky bar, pill area headers.
- **Motion:** presses (70 ms), the wrong-answer shake, the slip on the cliff (`cubic-bezier(.3,1.4,.5,1)`, 0.4 s), a pop on a solved target, the pulsing current Climb node, and confetti on wins. Everything respects `prefers-reduced-motion` (the last rule in the stylesheet).
- **Confetti (`#fx`):** a fixed canvas sized by CSS (100 % × 100 %). Its pixel size comes from `documentElement.clientWidth/Height`.
  - Never size it from `innerWidth`/`innerHeight` again: that made it, for a moment, a fixed box larger than the screen, and mobile browsers then doubled `innerHeight` until reload (found in v3 QA).
- **Do NOT:**
  - add a new override layer: change the stylesheet in place, component by component;
  - run DDL (create/alter) from a request path: schema changes are applied by hand, after checking the live database (owner rule);
  - set a palette token in only one of its day/night blocks;
  - use `var()` in SVG presentation attributes (colour SVG by class, or use `currentColor`);
  - bring back the cute v2 look on the shell: sea-creature avatars, the polka-dot background, the scalloped header wave, sticker shadows, glows or neon. The Climb trail's scenery is the one place the seaside cartoon stays;
  - go back to Latin Modern / JuliaMono (rejected in v2.1), or put Nunito/Fredoka back in the player app (the admin page still uses them);
  - add a framework or build step without reason;
  - re-add `user-scalable=no`;
  - use `.empty` except for the answer slot;
  - load Google Fonts (blocked by the admin CSP);
  - **expose the super_admin role in any player-facing or admin-facing response.**

## 5. Frameworks, libraries & tooling
- Runtime dependency: `@neondatabase/serverless@^1.2` (server only). Clients have zero dependencies.
- Node ≥ 20 (Vercel uses 26.x), ESM.
- **Fonts (v3):** the player app loads one file, `plus-jakarta-sans-latin-wght.woff2` (27 KB, `@fontsource-variable/plus-jakarta-sans@5.2.8`, weights 200–800). It is unmodified, so the original name is kept; the licence has no Reserved Font Name. It has tabular figures, and the Latin subset covers × ÷ −. Glyphs outside it (→ ✓ ⌫ ★) fall back to the system font. `admin.html` still loads Nunito (+ italic) and Fredoka (`@fontsource-variable/nunito@5.2.7`, `@fontsource-variable/fredoka@5.2.10`). Licences and sources are in `fonts/`.
- **npm scripts:** `migrate`, `role`.
- **Local QA (v3 harness; it lives in the session scratchpad, not the repo; rebuild it if the scratchpad has gone):**
  - Setup: in a scratch folder, `npm i @electric-sql/pglite@0.3.14 playwright-core@1.56.1`. The browser is the cached `~/.cache/ms-playwright/chromium_headless_shell-1208/chrome-headless-shell-linux64/chrome-headless-shell`.
  - `qa/server.mjs <appDir> <port>`, started with `node --import ./register.mjs server.mjs /mnt/c/Apps/sumDu3l 8787`:
    - serves the static files and mounts `api/*.js` on an **in-memory PGlite**, importing `scripts/migrate.js` at startup;
    - `register.mjs` and `hooks.mjs` redirect `@neondatabase/serverless` to `neon-shim.mjs` (tagged templates plus `.query`; int8 and numeric come back as strings, like Neon);
    - **nothing touches the live database**, and it doesn't apply the vercel.json headers.
  - `qa/t-live.mjs`: 82 API checks of the live games:
    - question shapes and answers;
    - the Climb's slip ordering and pace cap;
    - penalties, winners, server-written battles from both sides, and forfeits;
    - Truth or Lie sending no answers, cfg clean-up, the default game name, and the battles API.
  - `qa/e2e-live.mjs [games…]`: a phone browser (390×844, mobile) and a desktop browser play Climb, Target, Bigger, Missing Number and Duel through the UI, then quick match.
    - The flow: Arena card → lobby → make a game → the other player joins by code on the Arena → ready → play → both screens name the same winner → the record.
    - `LOOK_A=seaside:night LOOK_B=ascii:night` sets each player's palette, and `SHOTS=./dir/` the screenshot folder.
  - `qa/e2e-solo.mjs`: Pass the Phone, a Climb trail level, Daily VS against a bot, Sprint, Little Ones, the signed-out lobby, and join-by-code through sign-in.
  - `qa/views.mjs [quick]`: every view in the 8 looks, on phone and desktop. It takes full-page screenshots and checks for console errors and sideways overflow (the Players sort strip scrolls sideways on purpose).
  - `qa/contrast.cjs`, run from the app folder: the WCAG pairs.
  - `qa/sw-upgrade.mjs <scratch> [newDir]`: the deploy-upgrade check. It serves the last commit (exported with `git archive HEAD` into `<scratch>/old`) on port 8790, lets its service worker cache it, restarts the server on the new files, and checks the first load after the "deploy".
  - `qa/sheet.mjs`, `crop.mjs` and `clip.mjs`: contact sheets and crops made in the browser (there's no Pillow here).
  - Headless has no emoji font, so Little Ones' pictures render as boxes in screenshots.
- **Older harness (v2.2–v2.7, gone with an old scratchpad):**
  - `qa/server.mjs` mounted `api/*.js` (including `audit-cron` with `CRON_SECRET=test-cron-secret`) against the live database with `qa.*` users.
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
- **Schema:** by hand, never from a request path. First query the live database and state what's there, then get the owner's go. Then either `npm run migrate` (the whole idempotent script) or just the new statements. For v2.8 that's just these:
  `node --env-file=.env.local -e "import('./api/_schema.js').then(async ({V28}) => { const { neon } = await import('@neondatabase/serverless'); const sql = neon(process.env.DATABASE_URL); for (const s of V28) await sql.query(s); console.log('v2.8 schema applied') })"`
  **Applied to the live DB on 2026-11-13** (before the merge). The functions assume the tables exist. v3.0 needed no schema change.
- **Preview deployments share the production database** (`DATABASE_URL` is one value for production, preview and development), so anything tested on a preview writes to the live database.
- **Roles:** `npm run role -- <email> <role>`.

## 7. Roles & permissions
| Role | Set by | Sees / can do |
|---|---|---|
| **player** | default on sign-up | Play; read and write own battles and name; post scores; chat (subject to the filter, rate limit and mutes); report messages. `/admin` shows 404. |
| **admin** (Imogen, id 71) | super_admin in Players → role, or `npm run role` (Imogen was created by a one-off script) | **While chat is off (v2.6): the Players tab only** (search, reset players' passwords). With chat on, everything below. Everything a player can do, plus an "Admin tools" button on Account, `@` in chat, and the `/admin` Players and Chat tabs: search players, reset **players'** passwords, delete messages, mute or unmute **players**. Can't see the activity log, flags, audits or player details. Can't act on admin or super_admin accounts (generic "can't be changed from here" / "can't mute this player"). Sees the super_admin as an ordinary player. Password resets she does force the player to choose a new one. Every action is logged and listed in each audit. |
| **super_admin** (the owner) | **only** `npm run role` (CLI) | Looks exactly like a player in the game and in chat. Types `/admin` while signed in to get everything: all players with true roles, role changes, password resets for anyone, mutes for anyone, removed-message text, the flag review queue, the full activity log with CSV export, audits (run, read, mark reviewed), and per-player histories. |
