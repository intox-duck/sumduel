# Sum Duel

Quick maths, head to head: **https://sumduel.app**

- **The Duel**: face to face on a split screen, or take turns. Same questions, separate clocks, +3 s per wrong answer.
- **Truth or Lie**: a buzzer round. Call the equation true or false; first to 7 wins.
- **Sprint**: as many as you can in 60 s, with a global leaderboard.
- **The Daily**: 20 questions, the same for everyone that day, first attempt counts.
- **Live games**: play a friend on their own device: the Duel, Truth or Lie (judged round by round on server time) or a 60-second Sprint; public or private (password) games.
- **The Climb**: a seaside trail of levels, 12 per area, each a short challenge (beat the clock, truth or lie, missing number, target, mix-up, and a big one that opens a treasure chest). Stars and coins to win.
- **Coins, hearts and the daily gift**: every game pays coins; a Climb level costs a heart only if you don't make it; hearts refill every 10 minutes or cost a few coins; a 7-day gift calendar.
- **Daily VS**: race the ghost of anyone who's already played today, or one of three sea bots. The first race of the day pays a prize.
- **Home leaderboard**: today's Daily and Sprint top 5, with podiums, on the Arena.
- **Players dashboard**: once signed in, everyone's game report (games, wins, best scores, activity chart), by display name only.
- **Little Ones**: a picture level for 4-year-olds: count, find the side with more, tiny sums. Spoken prompts, no clock.
- **Accounts**: email + password, no confirmation. Every battle goes on your record, with head-to-head stats against each rival.

Static frontend (no build) + Vercel functions + Neon Postgres. Works offline as a PWA. Chat exists in the code but is switched off (`api/_features.js`).

```bash
npm install
vercel env pull .env.local   # DATABASE_URL from the Neon integration
npm run migrate              # idempotent schema
vercel dev
```

Architecture, data flow, design system and deploy notes: see [`master-ref.md`](master-ref.md).
