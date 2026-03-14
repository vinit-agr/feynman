# Feynman

Personal knowledge management and content creation system built with Next.js, Convex, and Claude AI.

## Prerequisites

- Node.js 18+
- [pnpm](https://pnpm.io/)
- A [Convex](https://www.convex.dev/) account
- An [Anthropic](https://www.anthropic.com/) API key (for ingestion/digest scripts)

## Setup

```bash
pnpm install
```

Copy the example env files and fill in your keys:

```bash
cp app/backend/.env.local.example app/backend/.env.local
cp app/feynman-lib/.env.example app/feynman-lib/.env
```

## Running the App

**Frontend (Next.js):**

```bash
pnpm dev:frontend
```

**Backend (Convex):**

```bash
pnpm dev:backend
```

## Ingestion Scripts

**Ingest Claude conversation transcripts:**

```bash
pnpm ingest:claude
```

**Ingest git history:**

```bash
pnpm ingest:git
```

**Generate a knowledge digest:**

```bash
pnpm digest:generate
```
