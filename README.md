# Feynman

Personal knowledge management and content creation system built with Next.js, Convex, and Claude AI.

## Prerequisites

- Node.js 18+
- npm
- A [Convex](https://www.convex.dev/) account
- An [Anthropic](https://www.anthropic.com/) API key (for ingestion/digest scripts)

## Setup

```bash
npm install
```

Copy the example env files and fill in your keys:

```bash
cp app/backend/.env.local.example app/backend/.env.local
cp app/feynman-lib/.env.example app/feynman-lib/.env
```

## Running the App

**Frontend (Next.js):**

```bash
npm run dev:frontend
```

**Backend (Convex):**

```bash
npm run dev:backend
```

## Ingestion Scripts

**Ingest Claude conversation transcripts:**

```bash
npm run ingest:claude
```

**Ingest git history:**

```bash
npm run ingest:git
```

**Generate a knowledge digest:**

```bash
npm run digest:generate
```
