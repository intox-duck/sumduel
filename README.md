# Sum Duel

Head-to-head mental maths on one phone: **https://sumduel.app**

- **The Duel**: face to face on a split screen, or take turns. Same questions, separate clocks, +3 s per wrong answer.
- **Truth or Lie**: a buzzer round. Call the equation true or false; first to 7 wins.
- **Sprint**: as many as you can in 60 s, with a global leaderboard.
- **The Daily**: 20 questions, the same for everyone that day, first attempt counts.
- **Accounts**: email + password, no confirmation. Every battle goes on your record, with head-to-head stats against each rival.

Static frontend (no build) + Vercel functions + Neon Postgres. Works offline as a PWA.

```bash
npm install
vercel env pull .env.local   # DATABASE_URL from the Neon integration
npm run migrate              # idempotent schema
vercel dev
```

Architecture, data flow, design system and deploy notes: see [`master-ref.md`](master-ref.md).
