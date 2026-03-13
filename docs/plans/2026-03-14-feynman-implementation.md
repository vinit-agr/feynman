# Project Feynman — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a personal knowledge management + content creation system with ingestion scripts, weekly digest generation, dual kanban pipelines, and searchable knowledge base.

**Architecture:** Next.js + React frontend, Convex backend/database, standalone TypeScript ingestion scripts that push data to Convex via HTTP client. Claude API for summarization, tagging, and digest generation.

**Tech Stack:** Next.js (App Router), React, Convex, TypeScript, Claude API (@anthropic-ai/sdk), tsx (for running scripts)

---

## Phase 1: Project Scaffolding & Convex Setup

### Task 1: Initialize monorepo structure and root config

**Files:**
- Create: `package.json` (root workspace config)
- Create: `tsconfig.base.json` (shared TypeScript config)
- Create: `.gitignore`
- Create: `CLAUDE.md`

**Step 1: Create root package.json with workspaces**

```json
{
  "name": "feynman",
  "private": true,
  "workspaces": [
    "app/backend",
    "app/feynman-lib",
    "app/frontend"
  ]
}
```

**Step 2: Create shared tsconfig.base.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  }
}
```

**Step 3: Create .gitignore**

```
node_modules/
.next/
.env
.env.local
dist/
.convex/
*.tsbuildinfo
```

**Step 4: Create CLAUDE.md with project conventions**

Document the repo structure, tech stack, and conventions (Convex for backend, scripts in feynman-lib, frontend in Next.js App Router).

**Step 5: Create placeholder directories**

```bash
mkdir -p app/backend app/feynman-lib/scripts/shared app/frontend/src
mkdir -p content/talking-head content/ai-videos content/blog content/social
mkdir -p knowledge/raw knowledge/curated
mkdir -p docs/plans docs/workflows
mkdir -p assets
```

**Step 6: Commit**

```bash
git add -A
git commit -m "feat: initialize feynman monorepo structure"
```

---

### Task 2: Set up Convex backend package

**Files:**
- Create: `app/backend/package.json`
- Create: `app/backend/tsconfig.json`
- Create: `app/backend/convex/schema.ts`
- Create: `app/backend/convex/tsconfig.json`

**Step 1: Create app/backend/package.json**

```json
{
  "name": "@feynman/backend",
  "private": true,
  "scripts": {
    "dev": "npx convex dev",
    "deploy": "npx convex deploy"
  },
  "dependencies": {
    "convex": "^1.21.0"
  }
}
```

**Step 2: Install dependencies**

```bash
cd app/backend && npm install
```

**Step 3: Initialize Convex project**

```bash
cd app/backend && npx convex init
```

This will create the `convex/` directory with `_generated/` files. The user will need to authenticate with their personal Convex account and create a new project named "feynman".

**Step 4: Create app/backend/convex/schema.ts**

This is the core data model for Feynman.

```typescript
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // Individual pieces of knowledge ingested from any source
  knowledgeEntries: defineTable({
    source: v.string(), // "claude-transcript" | "git-commit" | "youtube" | "twitter" | "telegram" | etc.
    sourceId: v.string(), // Unique ID from source (for dedup)
    title: v.string(),
    content: v.string(),
    summary: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    url: v.optional(v.string()),
    timestamp: v.number(), // When this knowledge was created/captured
    metadata: v.optional(v.any()),
    embedding: v.optional(v.array(v.float64())),
  })
    .index("by_source", ["source", "timestamp"])
    .index("by_source_id", ["source", "sourceId"])
    .index("by_timestamp", ["timestamp"])
    .searchIndex("search_content", {
      searchField: "content",
      filterFields: ["source"],
    })
    .vectorIndex("by_embedding", {
      vectorField: "embedding",
      dimensions: 1536,
      filterFields: ["source"],
    }),

  // Items in the knowledge curation pipeline
  knowledgeItems: defineTable({
    stage: v.union(
      v.literal("ideas"),
      v.literal("researching"),
      v.literal("learning"),
      v.literal("curated")
    ),
    topic: v.string(),
    description: v.optional(v.string()),
    linkedEntryIds: v.optional(v.array(v.id("knowledgeEntries"))),
    notes: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_stage", ["stage", "updatedAt"])
    .index("by_created", ["createdAt"]),

  // Items in the content creation pipeline
  contentItems: defineTable({
    stage: v.union(
      v.literal("ideas"),
      v.literal("researching"),
      v.literal("scripting"),
      v.literal("production"),
      v.literal("editing"),
      v.literal("review"),
      v.literal("published"),
      v.literal("archive")
    ),
    title: v.string(),
    description: v.optional(v.string()),
    format: v.union(
      v.literal("talking-head"),
      v.literal("ai-video"),
      v.literal("blog"),
      v.literal("twitter-thread"),
      v.literal("linkedin-post"),
      v.literal("other")
    ),
    script: v.optional(v.string()), // Script/outline content
    linkedKnowledgeItemIds: v.optional(v.array(v.id("knowledgeItems"))),
    linkedEntryIds: v.optional(v.array(v.id("knowledgeEntries"))),
    notes: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    publishedUrl: v.optional(v.string()),
    autoPopulated: v.optional(v.boolean()), // true if created from digest
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_stage", ["stage", "updatedAt"])
    .index("by_format", ["format", "stage"])
    .index("by_created", ["createdAt"]),

  // Generated weekly digests
  digests: defineTable({
    startDate: v.number(), // Start of the digest period
    endDate: v.number(), // End of the digest period
    activitySummary: v.string(),
    keyThemes: v.array(v.string()),
    contentIdeas: v.array(
      v.object({
        title: v.string(),
        format: v.string(),
        reasoning: v.string(),
      })
    ),
    knowledgeGaps: v.optional(v.array(v.string())),
    notableSaves: v.optional(v.array(v.string())),
    rawMarkdown: v.string(), // Full digest as markdown
    createdAt: v.number(),
  })
    .index("by_date", ["endDate"]),

  // Registered knowledge sources
  sources: defineTable({
    type: v.string(), // "claude-transcript" | "git-repo" | etc.
    name: v.string(), // Human-readable name
    config: v.optional(v.any()), // Source-specific config (paths, API keys ref, etc.)
    lastIngestedAt: v.optional(v.number()),
    entryCount: v.optional(v.number()),
    enabled: v.boolean(),
  })
    .index("by_type", ["type"]),
});
```

**Step 5: Push schema to Convex**

```bash
cd app/backend && npx convex dev --once
```

**Step 6: Commit**

```bash
git add -A
git commit -m "feat: set up Convex backend with full schema"
```

---

### Task 3: Create Convex CRUD functions for knowledgeEntries

**Files:**
- Create: `app/backend/convex/knowledgeEntries.ts`

**Step 1: Write the Convex query and mutation functions**

```typescript
import { v } from "convex/values";
import { query, mutation } from "./_generated/server";

export const list = query({
  args: {
    source: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  returns: v.array(v.any()),
  handler: async (ctx, args) => {
    const limit = args.limit ?? 50;
    if (args.source) {
      return await ctx.db
        .query("knowledgeEntries")
        .withIndex("by_source", (q) => q.eq("source", args.source!))
        .order("desc")
        .take(limit);
    }
    return await ctx.db
      .query("knowledgeEntries")
      .withIndex("by_timestamp")
      .order("desc")
      .take(limit);
  },
});

export const getBySourceId = query({
  args: {
    source: v.string(),
    sourceId: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    return await ctx.db
      .query("knowledgeEntries")
      .withIndex("by_source_id", (q) =>
        q.eq("source", args.source).eq("sourceId", args.sourceId)
      )
      .first();
  },
});

export const create = mutation({
  args: {
    source: v.string(),
    sourceId: v.string(),
    title: v.string(),
    content: v.string(),
    summary: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    url: v.optional(v.string()),
    timestamp: v.number(),
    metadata: v.optional(v.any()),
  },
  returns: v.id("knowledgeEntries"),
  handler: async (ctx, args) => {
    return await ctx.db.insert("knowledgeEntries", args);
  },
});

export const upsert = mutation({
  args: {
    source: v.string(),
    sourceId: v.string(),
    title: v.string(),
    content: v.string(),
    summary: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    url: v.optional(v.string()),
    timestamp: v.number(),
    metadata: v.optional(v.any()),
  },
  returns: v.id("knowledgeEntries"),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("knowledgeEntries")
      .withIndex("by_source_id", (q) =>
        q.eq("source", args.source).eq("sourceId", args.sourceId)
      )
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, args);
      return existing._id;
    }
    return await ctx.db.insert("knowledgeEntries", args);
  },
});

export const search = query({
  args: {
    query: v.string(),
    source: v.optional(v.string()),
  },
  returns: v.array(v.any()),
  handler: async (ctx, args) => {
    let searchQuery = ctx.db
      .query("knowledgeEntries")
      .withSearchIndex("search_content", (q) => {
        const base = q.search("content", args.query);
        if (args.source) {
          return base.eq("source", args.source);
        }
        return base;
      });
    return await searchQuery.take(20);
  },
});

export const getRecent = query({
  args: {
    afterTimestamp: v.number(),
    limit: v.optional(v.number()),
  },
  returns: v.array(v.any()),
  handler: async (ctx, args) => {
    const limit = args.limit ?? 200;
    const results = await ctx.db
      .query("knowledgeEntries")
      .withIndex("by_timestamp")
      .order("desc")
      .take(limit);
    return results.filter((e) => e.timestamp >= args.afterTimestamp);
  },
});
```

**Step 2: Push and verify**

```bash
cd app/backend && npx convex dev --once
```

**Step 3: Commit**

```bash
git add -A
git commit -m "feat: add knowledgeEntries CRUD and search functions"
```

---

### Task 4: Create Convex CRUD functions for pipelines and digests

**Files:**
- Create: `app/backend/convex/knowledgePipeline.ts`
- Create: `app/backend/convex/contentPipeline.ts`
- Create: `app/backend/convex/digests.ts`
- Create: `app/backend/convex/sources.ts`

**Step 1: Write app/backend/convex/knowledgePipeline.ts**

```typescript
import { v } from "convex/values";
import { query, mutation } from "./_generated/server";

const stageValidator = v.union(
  v.literal("ideas"),
  v.literal("researching"),
  v.literal("learning"),
  v.literal("curated")
);

export const list = query({
  args: { stage: v.optional(stageValidator) },
  returns: v.array(v.any()),
  handler: async (ctx, args) => {
    if (args.stage) {
      return await ctx.db
        .query("knowledgeItems")
        .withIndex("by_stage", (q) => q.eq("stage", args.stage!))
        .order("desc")
        .collect();
    }
    return await ctx.db.query("knowledgeItems").order("desc").collect();
  },
});

export const create = mutation({
  args: {
    stage: stageValidator,
    topic: v.string(),
    description: v.optional(v.string()),
    linkedEntryIds: v.optional(v.array(v.id("knowledgeEntries"))),
    notes: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
  },
  returns: v.id("knowledgeItems"),
  handler: async (ctx, args) => {
    const now = Date.now();
    return await ctx.db.insert("knowledgeItems", {
      ...args,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const updateStage = mutation({
  args: {
    id: v.id("knowledgeItems"),
    stage: stageValidator,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { stage: args.stage, updatedAt: Date.now() });
    return null;
  },
});

export const update = mutation({
  args: {
    id: v.id("knowledgeItems"),
    topic: v.optional(v.string()),
    description: v.optional(v.string()),
    notes: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    linkedEntryIds: v.optional(v.array(v.id("knowledgeEntries"))),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { id, ...fields } = args;
    await ctx.db.patch(id, { ...fields, updatedAt: Date.now() });
    return null;
  },
});

export const remove = mutation({
  args: { id: v.id("knowledgeItems") },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.delete(args.id);
    return null;
  },
});
```

**Step 2: Write app/backend/convex/contentPipeline.ts**

```typescript
import { v } from "convex/values";
import { query, mutation } from "./_generated/server";

const stageValidator = v.union(
  v.literal("ideas"),
  v.literal("researching"),
  v.literal("scripting"),
  v.literal("production"),
  v.literal("editing"),
  v.literal("review"),
  v.literal("published"),
  v.literal("archive")
);

const formatValidator = v.union(
  v.literal("talking-head"),
  v.literal("ai-video"),
  v.literal("blog"),
  v.literal("twitter-thread"),
  v.literal("linkedin-post"),
  v.literal("other")
);

export const list = query({
  args: {
    stage: v.optional(stageValidator),
    format: v.optional(formatValidator),
  },
  returns: v.array(v.any()),
  handler: async (ctx, args) => {
    if (args.stage) {
      return await ctx.db
        .query("contentItems")
        .withIndex("by_stage", (q) => q.eq("stage", args.stage!))
        .order("desc")
        .collect();
    }
    return await ctx.db.query("contentItems").order("desc").collect();
  },
});

export const create = mutation({
  args: {
    stage: stageValidator,
    title: v.string(),
    description: v.optional(v.string()),
    format: formatValidator,
    script: v.optional(v.string()),
    linkedKnowledgeItemIds: v.optional(v.array(v.id("knowledgeItems"))),
    linkedEntryIds: v.optional(v.array(v.id("knowledgeEntries"))),
    notes: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    autoPopulated: v.optional(v.boolean()),
  },
  returns: v.id("contentItems"),
  handler: async (ctx, args) => {
    const now = Date.now();
    return await ctx.db.insert("contentItems", {
      ...args,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const updateStage = mutation({
  args: {
    id: v.id("contentItems"),
    stage: stageValidator,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { stage: args.stage, updatedAt: Date.now() });
    return null;
  },
});

export const update = mutation({
  args: {
    id: v.id("contentItems"),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    script: v.optional(v.string()),
    notes: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    publishedUrl: v.optional(v.string()),
    linkedKnowledgeItemIds: v.optional(v.array(v.id("knowledgeItems"))),
    linkedEntryIds: v.optional(v.array(v.id("knowledgeEntries"))),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { id, ...fields } = args;
    await ctx.db.patch(id, { ...fields, updatedAt: Date.now() });
    return null;
  },
});

export const remove = mutation({
  args: { id: v.id("contentItems") },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.delete(args.id);
    return null;
  },
});

// Promote a curated knowledge item to a content idea
export const promoteFromKnowledge = mutation({
  args: {
    knowledgeItemId: v.id("knowledgeItems"),
    format: formatValidator,
  },
  returns: v.id("contentItems"),
  handler: async (ctx, args) => {
    const item = await ctx.db.get(args.knowledgeItemId);
    if (!item) throw new Error("Knowledge item not found");
    const now = Date.now();
    return await ctx.db.insert("contentItems", {
      stage: "ideas",
      title: item.topic,
      description: item.description,
      format: args.format,
      linkedKnowledgeItemIds: [args.knowledgeItemId],
      linkedEntryIds: item.linkedEntryIds,
      tags: item.tags,
      notes: item.notes,
      createdAt: now,
      updatedAt: now,
    });
  },
});
```

**Step 3: Write app/backend/convex/digests.ts**

```typescript
import { v } from "convex/values";
import { query, mutation } from "./_generated/server";

export const list = query({
  args: { limit: v.optional(v.number()) },
  returns: v.array(v.any()),
  handler: async (ctx, args) => {
    return await ctx.db
      .query("digests")
      .withIndex("by_date")
      .order("desc")
      .take(args.limit ?? 10);
  },
});

export const getLatest = query({
  args: {},
  returns: v.any(),
  handler: async (ctx) => {
    return await ctx.db
      .query("digests")
      .withIndex("by_date")
      .order("desc")
      .first();
  },
});

export const create = mutation({
  args: {
    startDate: v.number(),
    endDate: v.number(),
    activitySummary: v.string(),
    keyThemes: v.array(v.string()),
    contentIdeas: v.array(
      v.object({
        title: v.string(),
        format: v.string(),
        reasoning: v.string(),
      })
    ),
    knowledgeGaps: v.optional(v.array(v.string())),
    notableSaves: v.optional(v.array(v.string())),
    rawMarkdown: v.string(),
  },
  returns: v.id("digests"),
  handler: async (ctx, args) => {
    return await ctx.db.insert("digests", {
      ...args,
      createdAt: Date.now(),
    });
  },
});
```

**Step 4: Write app/backend/convex/sources.ts**

```typescript
import { v } from "convex/values";
import { query, mutation } from "./_generated/server";

export const list = query({
  args: {},
  returns: v.array(v.any()),
  handler: async (ctx) => {
    return await ctx.db.query("sources").collect();
  },
});

export const upsert = mutation({
  args: {
    type: v.string(),
    name: v.string(),
    config: v.optional(v.any()),
    enabled: v.boolean(),
  },
  returns: v.id("sources"),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("sources")
      .withIndex("by_type", (q) => q.eq("type", args.type))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, args);
      return existing._id;
    }
    return await ctx.db.insert("sources", { ...args });
  },
});

export const updateLastIngested = mutation({
  args: {
    type: v.string(),
    lastIngestedAt: v.number(),
    entryCount: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const source = await ctx.db
      .query("sources")
      .withIndex("by_type", (q) => q.eq("type", args.type))
      .first();
    if (source) {
      await ctx.db.patch(source._id, {
        lastIngestedAt: args.lastIngestedAt,
        entryCount: args.entryCount,
      });
    }
    return null;
  },
});
```

**Step 5: Push all functions**

```bash
cd app/backend && npx convex dev --once
```

**Step 6: Commit**

```bash
git add -A
git commit -m "feat: add Convex functions for pipelines, digests, and sources"
```

---

## Phase 2: feynman-lib Setup & First Ingestion Script

### Task 5: Set up feynman-lib package with shared types and Convex client

**Files:**
- Create: `app/feynman-lib/package.json`
- Create: `app/feynman-lib/tsconfig.json`
- Create: `app/feynman-lib/scripts/shared/types.ts`
- Create: `app/feynman-lib/scripts/shared/convex-client.ts`

**Step 1: Create app/feynman-lib/package.json**

```json
{
  "name": "@feynman/lib",
  "private": true,
  "type": "module",
  "scripts": {
    "ingest:claude": "tsx scripts/ingest-claude-transcripts.ts",
    "ingest:git": "tsx scripts/ingest-git-history.ts",
    "digest:generate": "tsx scripts/generate-digest.ts"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.52.0",
    "convex": "^1.21.0"
  },
  "devDependencies": {
    "tsx": "^4.19.0",
    "typescript": "^5.7.0",
    "@types/node": "^22.0.0"
  }
}
```

**Step 2: Create app/feynman-lib/tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./scripts",
    "module": "ESNext",
    "moduleResolution": "bundler"
  },
  "include": ["scripts/**/*.ts"]
}
```

**Step 3: Install dependencies**

```bash
cd app/feynman-lib && npm install
```

**Step 4: Create app/feynman-lib/scripts/shared/types.ts**

```typescript
export interface KnowledgeEntryInput {
  source: string;
  sourceId: string;
  title: string;
  content: string;
  summary?: string;
  tags?: string[];
  url?: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export interface DigestInput {
  startDate: number;
  endDate: number;
  activitySummary: string;
  keyThemes: string[];
  contentIdeas: {
    title: string;
    format: string;
    reasoning: string;
  }[];
  knowledgeGaps?: string[];
  notableSaves?: string[];
  rawMarkdown: string;
}

export interface IngestResult {
  source: string;
  entriesProcessed: number;
  entriesCreated: number;
  entriesSkipped: number;
  errors: string[];
}
```

**Step 5: Create app/feynman-lib/scripts/shared/convex-client.ts**

This wraps the Convex HTTP client for use by ingestion scripts.

```typescript
import { ConvexHttpClient } from "convex/browser";
import type { KnowledgeEntryInput } from "./types.js";

export function createConvexClient(): ConvexHttpClient {
  const url = process.env.CONVEX_URL;
  if (!url) {
    throw new Error(
      "CONVEX_URL environment variable is required. " +
      "Set it to your Convex deployment URL (e.g., https://your-project-123.convex.cloud)"
    );
  }
  return new ConvexHttpClient(url);
}

export async function upsertKnowledgeEntry(
  client: ConvexHttpClient,
  entry: KnowledgeEntryInput
): Promise<string> {
  // Use the HTTP API to call the upsert mutation
  const result = await client.mutation(
    "knowledgeEntries:upsert" as any,
    entry
  );
  return result as string;
}

export async function updateSourceLastIngested(
  client: ConvexHttpClient,
  sourceType: string,
  entryCount?: number
): Promise<void> {
  await client.mutation("sources:updateLastIngested" as any, {
    type: sourceType,
    lastIngestedAt: Date.now(),
    entryCount,
  });
}
```

**Step 6: Create .env.example at app/feynman-lib/.env.example**

```
CONVEX_URL=https://your-project.convex.cloud
ANTHROPIC_API_KEY=sk-ant-...
```

**Step 7: Commit**

```bash
git add -A
git commit -m "feat: set up feynman-lib with shared types and Convex client"
```

---

### Task 6: Build Claude transcripts ingestion script

**Files:**
- Create: `app/feynman-lib/scripts/ingest-claude-transcripts.ts`

This is the highest-priority ingestion script. It reads `.claude/` JSONL transcript files and extracts conversations as knowledge entries.

**Step 1: Write the ingestion script**

```typescript
import { readdir, readFile } from "node:fs/promises";
import { join, basename } from "node:path";
import { homedir } from "node:os";
import { createConvexClient, upsertKnowledgeEntry, updateSourceLastIngested } from "./shared/convex-client.js";
import type { KnowledgeEntryInput, IngestResult } from "./shared/types.js";

const SOURCE_TYPE = "claude-transcript";
const CLAUDE_DIR = join(homedir(), ".claude");

interface TranscriptMessage {
  role: string;
  content: string | { type: string; text?: string }[];
  timestamp?: string;
}

interface TranscriptEntry {
  type: string;
  message?: TranscriptMessage;
  timestamp?: string;
}

function extractTextFromContent(
  content: string | { type: string; text?: string }[]
): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((c) => c.type === "text" && c.text)
      .map((c) => c.text!)
      .join("\n");
  }
  return "";
}

async function findTranscriptFiles(baseDir: string): Promise<string[]> {
  const files: string[] = [];

  // Check projects directory for project-specific transcripts
  const projectsDir = join(baseDir, "projects");
  try {
    const projects = await readdir(projectsDir, { withFileTypes: true });
    for (const project of projects) {
      if (project.isDirectory()) {
        const projectPath = join(projectsDir, project.name);
        const projectFiles = await readdir(projectPath, { withFileTypes: true });
        for (const file of projectFiles) {
          if (file.name.endsWith(".jsonl") && file.isFile()) {
            files.push(join(projectPath, file.name));
          }
        }
      }
    }
  } catch {
    // projects dir may not exist
  }

  // Also check root .claude directory for global transcripts
  try {
    const rootFiles = await readdir(baseDir, { withFileTypes: true });
    for (const file of rootFiles) {
      if (file.name.endsWith(".jsonl") && file.isFile()) {
        files.push(join(baseDir, file.name));
      }
    }
  } catch {
    // ignore
  }

  return files;
}

function summarizeConversation(messages: TranscriptMessage[]): {
  title: string;
  content: string;
} {
  // Extract human messages for context and assistant messages for substance
  const humanMessages = messages
    .filter((m) => m.role === "human")
    .map((m) => extractTextFromContent(m.content))
    .filter((t) => t.length > 0);

  const assistantMessages = messages
    .filter((m) => m.role === "assistant")
    .map((m) => extractTextFromContent(m.content))
    .filter((t) => t.length > 0);

  // Title from first human message (truncated)
  const firstHuman = humanMessages[0] || "Untitled conversation";
  const title =
    firstHuman.length > 120
      ? firstHuman.substring(0, 120) + "..."
      : firstHuman;

  // Content is the full conversation (truncated to reasonable size)
  const fullContent = messages
    .map((m) => {
      const text = extractTextFromContent(m.content);
      const role = m.role === "human" ? "User" : "Assistant";
      return `**${role}:** ${text}`;
    })
    .join("\n\n");

  // Cap content at ~50K chars to avoid oversized entries
  const content =
    fullContent.length > 50000
      ? fullContent.substring(0, 50000) + "\n\n[...truncated]"
      : fullContent;

  return { title, content };
}

async function parseTranscriptFile(
  filePath: string
): Promise<KnowledgeEntryInput[]> {
  const entries: KnowledgeEntryInput[] = [];
  const raw = await readFile(filePath, "utf-8");
  const lines = raw.split("\n").filter((l) => l.trim());

  const messages: TranscriptMessage[] = [];
  let firstTimestamp: string | undefined;
  let lastTimestamp: string | undefined;

  for (const line of lines) {
    try {
      const parsed: TranscriptEntry = JSON.parse(line);
      if (parsed.message) {
        messages.push(parsed.message);
        if (parsed.timestamp) {
          if (!firstTimestamp) firstTimestamp = parsed.timestamp;
          lastTimestamp = parsed.timestamp;
        }
      }
    } catch {
      // skip malformed lines
    }
  }

  if (messages.length === 0) return entries;

  const { title, content } = summarizeConversation(messages);
  const timestamp = firstTimestamp
    ? new Date(firstTimestamp).getTime()
    : Date.now();

  const sourceId = basename(filePath, ".jsonl");

  entries.push({
    source: SOURCE_TYPE,
    sourceId,
    title,
    content,
    timestamp,
    metadata: {
      filePath,
      messageCount: messages.length,
      firstTimestamp,
      lastTimestamp,
    },
  });

  return entries;
}

async function main() {
  console.log("🔍 Scanning for Claude Code transcripts...");

  const client = createConvexClient();
  const result: IngestResult = {
    source: SOURCE_TYPE,
    entriesProcessed: 0,
    entriesCreated: 0,
    entriesSkipped: 0,
    errors: [],
  };

  const files = await findTranscriptFiles(CLAUDE_DIR);
  console.log(`Found ${files.length} transcript files`);

  for (const file of files) {
    try {
      const entries = await parseTranscriptFile(file);
      for (const entry of entries) {
        result.entriesProcessed++;
        try {
          await upsertKnowledgeEntry(client, entry);
          result.entriesCreated++;
          console.log(`  ✓ ${entry.title.substring(0, 80)}`);
        } catch (err) {
          result.entriesSkipped++;
          result.errors.push(`Failed to upsert ${entry.sourceId}: ${err}`);
        }
      }
    } catch (err) {
      result.errors.push(`Failed to parse ${file}: ${err}`);
    }
  }

  await updateSourceLastIngested(client, SOURCE_TYPE, result.entriesCreated);

  console.log("\n--- Ingestion Complete ---");
  console.log(`Processed: ${result.entriesProcessed}`);
  console.log(`Created/Updated: ${result.entriesCreated}`);
  console.log(`Skipped: ${result.entriesSkipped}`);
  if (result.errors.length > 0) {
    console.log(`Errors: ${result.errors.length}`);
    result.errors.forEach((e) => console.error(`  ! ${e}`));
  }
}

main().catch(console.error);
```

**Step 2: Test the script locally**

```bash
cd app/feynman-lib && CONVEX_URL=<your-convex-url> npm run ingest:claude
```

**Step 3: Commit**

```bash
git add -A
git commit -m "feat: add Claude transcripts ingestion script"
```

---

### Task 7: Build Git history ingestion script

**Files:**
- Create: `app/feynman-lib/scripts/ingest-git-history.ts`

**Step 1: Write the ingestion script**

```typescript
import { execSync } from "node:child_process";
import { createConvexClient, upsertKnowledgeEntry, updateSourceLastIngested } from "./shared/convex-client.js";
import type { KnowledgeEntryInput, IngestResult } from "./shared/types.js";

const SOURCE_TYPE = "git-commit";

interface GitCommit {
  hash: string;
  author: string;
  date: string;
  message: string;
  diff: string;
  repo: string;
}

function getGitLog(repoPath: string, since?: string): GitCommit[] {
  const sinceArg = since ? `--since="${since}"` : "--since='30 days ago'";
  const repoName = repoPath.split("/").pop() || repoPath;

  try {
    // Use %x00 as delimiter between fields, %x01 as delimiter between commits
    const format = "%H%x00%an%x00%aI%x00%B";
    const raw = execSync(
      `git -C "${repoPath}" log ${sinceArg} --format="${format}" --no-merges`,
      { encoding: "utf-8", maxBuffer: 10 * 1024 * 1024 }
    );

    if (!raw.trim()) return [];

    const commits: GitCommit[] = [];
    const entries = raw.trim().split("\n\n");

    // Parse each commit
    for (const entry of entries) {
      const lines = entry.trim();
      if (!lines) continue;

      // Split by the first few null chars to get fields
      const parts = lines.split("\0");
      if (parts.length < 4) continue;

      const [hash, author, date, ...messageParts] = parts;
      const message = messageParts.join("").trim();

      // Get diff stat for this commit
      let diff = "";
      try {
        diff = execSync(
          `git -C "${repoPath}" diff-tree --no-commit-id -p --stat "${hash}"`,
          { encoding: "utf-8", maxBuffer: 5 * 1024 * 1024 }
        ).substring(0, 5000); // Cap diff size
      } catch {
        // ignore diff errors
      }

      commits.push({ hash, author, date, message, diff, repo: repoName });
    }

    return commits;
  } catch (err) {
    console.error(`Failed to read git log from ${repoPath}: ${err}`);
    return [];
  }
}

function commitToEntry(commit: GitCommit): KnowledgeEntryInput {
  const content = [
    `**Commit:** ${commit.hash}`,
    `**Author:** ${commit.author}`,
    `**Repo:** ${commit.repo}`,
    `**Date:** ${commit.date}`,
    "",
    commit.message,
    "",
    "```",
    commit.diff,
    "```",
  ].join("\n");

  return {
    source: SOURCE_TYPE,
    sourceId: `${commit.repo}:${commit.hash}`,
    title: `[${commit.repo}] ${commit.message.split("\n")[0].substring(0, 100)}`,
    content,
    timestamp: new Date(commit.date).getTime(),
    metadata: {
      repo: commit.repo,
      hash: commit.hash,
      author: commit.author,
    },
  };
}

async function main() {
  // Configure repos to scan — passed as CLI args or defaults
  const repoPaths = process.argv.slice(2);

  if (repoPaths.length === 0) {
    console.log("Usage: tsx ingest-git-history.ts <repo-path-1> [repo-path-2] ...");
    console.log("Example: tsx ingest-git-history.ts ~/Tars/Development/my-project ~/other-repo");
    process.exit(1);
  }

  const client = createConvexClient();
  const result: IngestResult = {
    source: SOURCE_TYPE,
    entriesProcessed: 0,
    entriesCreated: 0,
    entriesSkipped: 0,
    errors: [],
  };

  for (const repoPath of repoPaths) {
    console.log(`\n📂 Scanning ${repoPath}...`);
    const commits = getGitLog(repoPath);
    console.log(`  Found ${commits.length} commits`);

    for (const commit of commits) {
      result.entriesProcessed++;
      const entry = commitToEntry(commit);
      try {
        await upsertKnowledgeEntry(client, entry);
        result.entriesCreated++;
      } catch (err) {
        result.entriesSkipped++;
        result.errors.push(`Failed: ${commit.hash}: ${err}`);
      }
    }
  }

  await updateSourceLastIngested(client, SOURCE_TYPE, result.entriesCreated);

  console.log("\n--- Git Ingestion Complete ---");
  console.log(`Processed: ${result.entriesProcessed}`);
  console.log(`Created/Updated: ${result.entriesCreated}`);
  console.log(`Skipped: ${result.entriesSkipped}`);
  if (result.errors.length > 0) {
    console.log(`Errors: ${result.errors.length}`);
  }
}

main().catch(console.error);
```

**Step 2: Test**

```bash
cd app/feynman-lib && CONVEX_URL=<url> tsx scripts/ingest-git-history.ts ~/Tars/Development/some-repo
```

**Step 3: Commit**

```bash
git add -A
git commit -m "feat: add git history ingestion script"
```

---

## Phase 3: Digest Generation

### Task 8: Build digest generation script

**Files:**
- Create: `app/feynman-lib/scripts/generate-digest.ts`

**Step 1: Write the digest generation script**

```typescript
import Anthropic from "@anthropic-ai/sdk";
import { ConvexHttpClient } from "convex/browser";
import { createConvexClient } from "./shared/convex-client.js";

const DIGEST_PROMPT = `You are a personal knowledge assistant helping create a weekly digest.

Given the following knowledge entries from the past week, generate a structured digest with these sections:

1. **Activity Summary** — What was worked on across different sources (2-3 paragraphs)
2. **Key Themes** — 3-5 recurring topics or areas of focus (as a list)
3. **Content Ideas** — 3-5 suggested content pieces. For each:
   - Title (catchy, specific)
   - Format (talking-head video, AI-animated video, blog post, twitter thread, linkedin post)
   - Reasoning (why this would resonate, what makes it authentic)
4. **Knowledge Gaps** — Areas that were explored but not resolved (2-3 items)
5. **Notable Saves** — Interesting bookmarks, links, or references from the period

Return the digest as structured JSON with this shape:
{
  "activitySummary": "...",
  "keyThemes": ["...", "..."],
  "contentIdeas": [{"title": "...", "format": "...", "reasoning": "..."}],
  "knowledgeGaps": ["...", "..."],
  "notableSaves": ["...", "..."],
  "rawMarkdown": "... full digest as readable markdown ..."
}

Knowledge entries from the past week:
`;

interface DigestData {
  activitySummary: string;
  keyThemes: string[];
  contentIdeas: { title: string; format: string; reasoning: string }[];
  knowledgeGaps: string[];
  notableSaves: string[];
  rawMarkdown: string;
}

async function fetchRecentEntries(
  client: ConvexHttpClient,
  daysBack: number = 7
): Promise<any[]> {
  const since = Date.now() - daysBack * 24 * 60 * 60 * 1000;
  return await client.query("knowledgeEntries:getRecent" as any, {
    afterTimestamp: since,
    limit: 500,
  });
}

function formatEntriesForPrompt(entries: any[]): string {
  // Group by source
  const bySource: Record<string, any[]> = {};
  for (const entry of entries) {
    if (!bySource[entry.source]) bySource[entry.source] = [];
    bySource[entry.source].push(entry);
  }

  let prompt = "";
  for (const [source, sourceEntries] of Object.entries(bySource)) {
    prompt += `\n## Source: ${source} (${sourceEntries.length} entries)\n\n`;
    for (const entry of sourceEntries.slice(0, 50)) {
      prompt += `### ${entry.title}\n`;
      // Truncate content for prompt
      const content =
        entry.content.length > 2000
          ? entry.content.substring(0, 2000) + "..."
          : entry.content;
      prompt += `${content}\n\n`;
    }
  }
  return prompt;
}

async function generateDigest(entries: any[]): Promise<DigestData> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY environment variable required");

  const anthropic = new Anthropic({ apiKey });

  const entriesText = formatEntriesForPrompt(entries);
  const fullPrompt = DIGEST_PROMPT + entriesText;

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 4096,
    messages: [{ role: "user", content: fullPrompt }],
  });

  const text =
    response.content[0].type === "text" ? response.content[0].text : "";

  // Extract JSON from response
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("Failed to extract JSON from Claude response");

  return JSON.parse(jsonMatch[0]) as DigestData;
}

async function main() {
  const daysBack = parseInt(process.argv[2] || "7", 10);

  console.log(`📊 Generating digest for the past ${daysBack} days...`);

  const client = createConvexClient();
  const entries = await fetchRecentEntries(client, daysBack);

  if (entries.length === 0) {
    console.log("No knowledge entries found for this period. Run ingestion first.");
    return;
  }

  console.log(`Found ${entries.length} entries across sources`);

  const digest = await generateDigest(entries);
  const now = Date.now();
  const startDate = now - daysBack * 24 * 60 * 60 * 1000;

  // Store in Convex
  await client.mutation("digests:create" as any, {
    startDate,
    endDate: now,
    activitySummary: digest.activitySummary,
    keyThemes: digest.keyThemes,
    contentIdeas: digest.contentIdeas,
    knowledgeGaps: digest.knowledgeGaps || [],
    notableSaves: digest.notableSaves || [],
    rawMarkdown: digest.rawMarkdown,
  });

  console.log("\n✅ Digest generated and stored!");
  console.log("\n--- Digest Preview ---\n");
  console.log(digest.rawMarkdown);
}

main().catch(console.error);
```

**Step 2: Test**

```bash
cd app/feynman-lib && CONVEX_URL=<url> ANTHROPIC_API_KEY=<key> npm run digest:generate
```

**Step 3: Commit**

```bash
git add -A
git commit -m "feat: add weekly digest generation script"
```

---

## Phase 4: Next.js Frontend Setup

### Task 9: Scaffold Next.js app with Convex provider

**Files:**
- Create: `app/frontend/package.json`
- Create: `app/frontend/src/app/layout.tsx`
- Create: `app/frontend/src/app/page.tsx`
- Create: `app/frontend/src/app/providers.tsx`
- Create: `app/frontend/next.config.ts`
- Create: `app/frontend/tsconfig.json`
- Create: `app/frontend/tailwind.config.ts`

**Step 1: Create Next.js app**

```bash
cd app/frontend && npx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir --no-import-alias
```

**Step 2: Install Convex client**

```bash
cd app/frontend && npm install convex
```

**Step 3: Create app/frontend/src/app/providers.tsx**

```tsx
"use client";

import { ConvexProvider, ConvexReactClient } from "convex/react";
import { ReactNode } from "react";

const convex = new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

export function Providers({ children }: { children: ReactNode }) {
  return <ConvexProvider client={convex}>{children}</ConvexProvider>;
}
```

**Step 4: Update app/frontend/src/app/layout.tsx to wrap with providers**

```tsx
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Feynman — Knowledge & Content Studio",
  description: "Personal knowledge management and content creation system",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className={inter.className}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
```

**Step 5: Create a minimal landing page at app/frontend/src/app/page.tsx**

```tsx
export default function Home() {
  return (
    <main className="min-h-screen bg-gray-950 text-gray-100 flex items-center justify-center">
      <div className="text-center">
        <h1 className="text-4xl font-bold mb-4">Feynman</h1>
        <p className="text-gray-400 text-lg">
          Knowledge &amp; Content Studio
        </p>
      </div>
    </main>
  );
}
```

**Step 6: Add .env.local**

```
NEXT_PUBLIC_CONVEX_URL=https://your-project.convex.cloud
```

**Step 7: Verify it runs**

```bash
cd app/frontend && npm run dev
```

**Step 8: Commit**

```bash
git add -A
git commit -m "feat: scaffold Next.js frontend with Convex provider"
```

---

### Task 10: Build Dashboard page with digest view

**Files:**
- Create: `app/frontend/src/app/dashboard/page.tsx`
- Create: `app/frontend/src/components/DigestCard.tsx`
- Create: `app/frontend/src/components/PipelineSnapshot.tsx`
- Create: `app/frontend/src/components/Sidebar.tsx`

**Step 1: Build Sidebar navigation component**

Navigation links: Dashboard, Content Pipeline, Knowledge Pipeline, Search.
Dark theme, minimal design, Linear-inspired.

**Step 2: Build DigestCard component**

Displays the latest digest: activity summary, key themes as tags, content ideas as cards with format badges, knowledge gaps, notable saves. Use Convex `useQuery` to fetch from `digests:getLatest`.

**Step 3: Build PipelineSnapshot component**

Shows count of items in each stage for both pipelines. Uses `useQuery` on `knowledgePipeline:list` and `contentPipeline:list`, groups by stage.

**Step 4: Compose Dashboard page**

Combines DigestCard, PipelineSnapshot, recent knowledge entries list, and quick action buttons.

**Step 5: Update root layout to include Sidebar**

**Step 6: Verify dashboard renders with data**

```bash
cd app/frontend && npm run dev
```

**Step 7: Commit**

```bash
git add -A
git commit -m "feat: add dashboard page with digest view and pipeline snapshot"
```

---

### Task 11: Build Content Pipeline kanban page

**Files:**
- Create: `app/frontend/src/app/content/page.tsx`
- Create: `app/frontend/src/components/KanbanBoard.tsx`
- Create: `app/frontend/src/components/KanbanColumn.tsx`
- Create: `app/frontend/src/components/ContentCard.tsx`
- Create: `app/frontend/src/components/ContentDetailModal.tsx`

**Step 1: Build KanbanBoard — generic horizontal kanban component**

Accepts columns config and items. Supports drag-and-drop (use `@hello-pangea/dnd` or native HTML drag).

**Step 2: Build KanbanColumn — renders a single column with cards**

Column header with count badge, scrollable card list.

**Step 3: Build ContentCard — card for a content item**

Shows title, format badge (color-coded), tags, date. Click opens detail modal.

**Step 4: Build ContentDetailModal — expanded view for editing**

Edit title, description, script/outline (textarea), notes, tags. Update stage via dropdown. Link knowledge items. Save via `contentPipeline:update` mutation.

**Step 5: Compose Content Pipeline page**

8 columns: Ideas, Researching, Scripting, Production, Editing, Review, Published, Archive. Filter bar for format. "Add idea" button. Uses `useQuery` for `contentPipeline:list` and `useMutation` for `contentPipeline:updateStage`.

**Step 6: Commit**

```bash
git add -A
git commit -m "feat: add content pipeline kanban page"
```

---

### Task 12: Build Knowledge Pipeline kanban page

**Files:**
- Create: `app/frontend/src/app/knowledge/page.tsx`
- Create: `app/frontend/src/components/KnowledgeCard.tsx`
- Create: `app/frontend/src/components/KnowledgeDetailModal.tsx`

**Step 1: Build KnowledgeCard**

Shows topic, tags, source references count. Click opens detail.

**Step 2: Build KnowledgeDetailModal**

Edit topic, description, notes. View linked knowledge entries. "Promote to Content" button that calls `contentPipeline:promoteFromKnowledge`.

**Step 3: Compose Knowledge Pipeline page**

4 columns: Ideas, Researching, Learning, Curated. Reuses KanbanBoard/KanbanColumn. "Add topic" button.

**Step 4: Commit**

```bash
git add -A
git commit -m "feat: add knowledge pipeline kanban page"
```

---

### Task 13: Build Search page

**Files:**
- Create: `app/frontend/src/app/search/page.tsx`
- Create: `app/frontend/src/components/SearchResults.tsx`
- Create: `app/frontend/src/components/EntryCard.tsx`

**Step 1: Build Search page with search bar**

Input field with debounced search. Source filter dropdown. Date range picker. Uses `useQuery` on `knowledgeEntries:search`.

**Step 2: Build SearchResults list**

Shows matching entries with source icon, title, content snippet (highlighted match), timestamp, tags.

**Step 3: Build EntryCard — expandable result card**

Click to expand full content. Link to add to knowledge pipeline or content pipeline.

**Step 4: Commit**

```bash
git add -A
git commit -m "feat: add search page with full-text search"
```

---

## Phase 5: Additional Ingestion Scripts

### Task 14: Build Telegram saved messages ingestion script

**Files:**
- Create: `app/feynman-lib/scripts/ingest-telegram-saved.ts`

Supports two modes:
1. Read from exported Telegram JSON (from Telegram Desktop export)
2. Future: Telegram Bot API integration

Parses messages, extracts text + URLs, creates knowledge entries.

**Step 1: Write the script**
**Step 2: Test with exported data**
**Step 3: Commit**

---

### Task 15: Build YouTube watch history ingestion script

**Files:**
- Create: `app/feynman-lib/scripts/ingest-youtube-history.ts`

Reads Google Takeout YouTube watch history JSON. For each video:
- Extract title, URL, channel, watch date
- Optionally fetch transcript via YouTube transcript API
- Use Claude API to classify as "learning" vs "entertainment"

**Step 1: Write the script**
**Step 2: Test with Takeout export**
**Step 3: Commit**

---

### Task 16: Build Twitter bookmarks ingestion script

**Files:**
- Create: `app/feynman-lib/scripts/ingest-twitter-bookmarks.ts`

Reads from Twitter data export (bookmarks.js). Extracts tweet text, author, URL, timestamp.

**Step 1: Write the script**
**Step 2: Test with export data**
**Step 3: Commit**

---

## Phase 6: Polish & Automation

### Task 17: Add auto-summarization and auto-tagging to ingestion

**Files:**
- Modify: `app/feynman-lib/scripts/shared/convex-client.ts`
- Create: `app/feynman-lib/scripts/shared/ai-enrichment.ts`

Add a utility that takes a knowledge entry and uses Claude API to:
1. Generate a 2-3 sentence summary
2. Extract 3-5 relevant tags
3. Return enriched entry

Hook this into all ingestion scripts as an optional enrichment step (controlled by env var `ENRICH_WITH_AI=true`).

**Step 1: Write ai-enrichment.ts**
**Step 2: Integrate into ingest scripts**
**Step 3: Test**
**Step 4: Commit**

---

### Task 18: Add scheduled digest generation

**Files:**
- Create: `app/backend/convex/crons.ts`

Set up a Convex cron job that triggers digest generation every Friday at 6 PM. Uses Convex's built-in cron scheduling.

```typescript
import { cronJobs } from "convex/server";

const crons = cronJobs();

crons.weekly(
  "weekly-digest",
  { dayOfWeek: "friday", hourUTC: 23, minuteUTC: 0 }, // ~6 PM ET
  "digests:generateWeekly", // Convex action that calls Claude API
  {}
);

export default crons;
```

**Step 1: Create the cron config**
**Step 2: Create the Convex action for digest generation**
**Step 3: Deploy and verify**
**Step 4: Commit**

---

## Implementation Priority Summary

| Phase | Tasks | Description | Estimated Effort |
|-------|-------|-------------|-----------------|
| 1 | 1-4 | Project scaffolding, Convex schema, CRUD functions | Foundation |
| 2 | 5-7 | feynman-lib, Claude + Git ingestion scripts | First value — data flowing in |
| 3 | 8 | Digest generation | Core feature — weekly insights |
| 4 | 9-13 | Next.js frontend — dashboard, kanbans, search | Visual interface |
| 5 | 14-16 | Additional ingestion scripts (Telegram, YouTube, Twitter) | More data sources |
| 6 | 17-18 | AI enrichment, scheduled automation | Polish & automation |

**Recommended approach:** Complete Phases 1-3 first. This gets data flowing and digests generating — the highest-value features. The frontend (Phase 4) can be built incrementally after that. Additional ingestion scripts (Phase 5) can be added one at a time as needed.
