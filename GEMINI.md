# Agent guide

The canonical guide is `docs/agents/ARCHITECTURE.md`. Read it first. Your task brief is in `docs/agents/TASKS.md`.

```
npm install
npm run dev       http://localhost:5173
npm test
npm run build     also the check for broken imports
npm run serve -- up --lanes --sessions   one port, no Vite (npm run build first)
```

There is no separate lint or analyze step yet.
