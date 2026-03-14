# Project Feynman

Personal knowledge management and content creation system.

## Repo Structure

This is a monorepo with 3 workspaces:

```
app/
  backend/       — Convex backend (database, serverless functions, actions)
  feynman-lib/   — Pure TypeScript scripts for ingestion and processing (run via tsx)
  frontend/      — Next.js App Router frontend
docs/
  plans/         — Design docs and implementation plans
  workflows/     — Workflow documentation
```

All data (knowledge, content, assets) is stored in the Convex database — not on the filesystem.

## Tech Stack

- **Backend/Database:** Convex (schema, mutations, queries, actions)
- **Frontend:** Next.js with App Router
- **Scripts:** Pure TypeScript, executed with tsx
- **AI:** Claude API for summarization, digest generation, and content assistance

## Conventions

- Package manager: pnpm (workspaces defined in pnpm-workspace.yaml)
- TypeScript: strict mode, ES2022 target, bundler module resolution (see tsconfig.base.json)
- Each workspace extends tsconfig.base.json for shared compiler options
- Convex functions live in `app/backend/convex/`
- Ingestion scripts live in `app/feynman-lib/scripts/`
- Shared utilities for scripts live in `app/feynman-lib/scripts/shared/`
