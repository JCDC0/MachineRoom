# Agent guide

Read `docs/agents/ARCHITECTURE.md` first, then `docs/agents/HOUSE-RULES.md`, then your brief in `docs/agents/TASKS.md`.

The code is the first authority, then `docs/agents/ARCHITECTURE.md`, then every other doc.

```
npm install
npm run dev       http://localhost:5173
npm test
npm run build     also the check for broken imports
npm run serve -- up --lanes --sessions   one port, no Vite (npm run build first)
```

There is no separate lint or analyze step yet.
