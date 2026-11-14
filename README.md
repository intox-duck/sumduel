# Sum Duel

Quick maths, head to head: **https://sumduel.app**

**Play Online**: eight live games, everyone on their own device (all signed in), server-timed, public or private (password) games, and "Find an opponent" for one-tap matches. Seven are for two players and Treasure Dive is for two to four:

- **Duel**: the same sums for both of you, separate clocks, +3 s per wrong answer. Fastest time wins.
- **The Climb**: race up a rope of 8, 12, 16 or 20 ledges that gets harder as you go, with both climbers drawn pulling themselves up hand over hand. A wrong answer slips you down a knot. First to the top wins.
- **Treasure Dive** (2–4 players): the same sum for every diver at the same moment, four answers to pick from. Right answers dive 2 m, the fastest right answer 1 m more, a wrong one floats you up 1 m, and the last round counts double. The deepest diver finds the treasure.
- **Truth or Lie**: call each sum true or a lie; the quickest right call scores. First to 7.
- **Sprint**: 60 seconds of sums. Most right answers wins.
- **Missing Number**: find the hidden number, like 7 × ? = 42.
- **Target**: combine the number tiles with + − × ÷ to hit the target. Five puzzles; a skip costs 10 s.
- **Bigger**: two sums side by side; tap the bigger one. Fifteen pairs, +3 s per wrong tap.

**On This Device**:

- **Climb the Coast**: a seaside trail of levels, 12 per area, with stars, coins and a treasure chest at the end of every area.
- **The Daily**: 20 questions, the same for everyone that day; the first attempt counts.
- **Daily VS**: race the ghost of anyone who's already played today, or one of three bots. The first race of the day pays a prize.
- **Sprint** (solo, with a global leaderboard), **Pass the Phone** (a take-turns Duel on one device) and **Little Ones** (counting with pictures and a voice, for ages 4 to 6).

Also:

- **Coins, hearts and the daily gift**: every game pays coins; a Climb the Coast level costs a heart only if you don't make it; hearts refill every 10 minutes or cost a few coins; a 7-day gift calendar.
- **Home leaderboard**: today's Daily and Sprint top 5, with podiums, on the Arena.
- **Players dashboard**: once signed in, everyone's game report (games, wins, best scores, activity chart), by display name only.
- **Your Colours**: four palettes on the Arena and in Preferences (Seaside, Shades of Blue, Shades of Pink and ASCII Mode), each with day and night.
- **Accounts**: email + password, no confirmation. Every battle goes on your record, with head-to-head stats against each rival.

Static frontend (no build) + Vercel functions + Neon Postgres. Works offline as a PWA. Chat exists in the code but is switched off (`api/_features.js`).

```bash
npm install
vercel env pull .env.local   # DATABASE_URL from the Neon integration
npm run migrate              # idempotent schema (on the live database: check first, apply by hand, before deploying)
vercel dev
```

Architecture, data flow, design system and deploy notes: see [`master-ref.md`](master-ref.md).
