# Sum Duel

Quick maths, head to head: **https://sumduel.app**

- **The Duel**: face to face on a split screen, or take turns. Same questions, separate clocks, +3 s per wrong answer.
- **Truth or Lie**: a buzzer round. Call the equation true or false; first to 7 wins.
- **Sprint**: as many as you can in 60 s, with a global leaderboard.
- **The Daily**: 20 questions, the same for everyone that day, first attempt counts.
- **Live Duel**: race a friend on their own device; public or private (password) games, server-timed.
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
