# Convex Setup

Stage 0 includes a minimal Convex directory so `npx convex dev` can initialize a
local deployment and generate Convex client types. Product tables, mutations, and
queries are intentionally deferred to Stage 1 and later.

Run:

```bash
npm run convex:dev
```

The Convex CLI will write the local deployment values needed by the app into
`.env.local`.
