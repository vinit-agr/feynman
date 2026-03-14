# Knowledge Ingestion Redesign Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the knowledge ingestion system to preserve raw files in Convex storage, support multiple per-source extractors via Convex Workpool, and restructure the frontend with accordion-based navigation and source detail pages.

**Architecture:** Raw JSONL files are uploaded from local machine to Convex file storage by a simplified script. Convex Workpool automatically runs mechanical extractors to produce knowledge entries. AI extractors run on-demand. Frontend uses nested accordion sidebar with source detail pages that show filterable entry lists with slide-over panels.

**Tech Stack:** Convex (backend, file storage, workpool), Next.js App Router (frontend), TypeScript, shadcn UI components, `@convex-dev/workpool`

**Spec:** `docs/superpowers/specs/2026-03-14-knowledge-ingestion-redesign.md`

---

## File Structure

### New Backend Files (`app/backend/convex/`)

| File | Responsibility |
|------|---------------|
| `convex.config.ts` | Register workpool component (in `convex/` directory) |
| `extractionPool.ts` | Workpool instance + `defineOnComplete` handler (NO `"use node"`) |
| `rawFiles.ts` | CRUD mutations/queries for raw file records |
| `extractors.ts` | Extractor config queries + seed mutation |
| `extraction.ts` | `runExtractor` action, mechanical parser registry (`"use node"`) |

### Modified Backend Files

| File | Changes |
|------|---------|
| `schema.ts` | Add `rawFiles`, `extractors` tables; add `rawFileId`, `extractorName` to `knowledgeEntries` |
| `knowledgeEntries.ts` | Add `listByRawFile` and `listByExtractor` queries |

### New Frontend Files (`app/frontend/src/`)

| File | Responsibility |
|------|---------------|
| `app/(app)/knowledge/sources/claude-transcripts/page.tsx` | Source detail page with filterable list |
| `app/(app)/knowledge/sources/git-history/page.tsx` | Placeholder page |
| `app/(app)/knowledge/pipeline/page.tsx` | Moved from `knowledge/page.tsx` |
| `components/knowledge/source-entry-list.tsx` | Filterable entry list component |
| `components/knowledge/entry-slide-over.tsx` | Slide-over panel for entry detail |
| `components/knowledge/raw-files-list.tsx` | Raw files browser |

### Modified Frontend Files

| File | Changes |
|------|---------|
| `components/app-sidebar.tsx` | Nested accordion nav with Knowledge > Sources + Pipeline |
| `app/(app)/dashboard/page.tsx` | Remove RecentEntries import and usage |

### Modified Script Files (`app/feynman-lib/scripts/`)

| File | Changes |
|------|---------|
| `ingest-claude-transcripts.ts` | Rewrite to upload-only (no parsing) |
| `shared/convex-client.ts` | Add upload URL generation and rawFiles mutations |

---

## Chunk 1: Backend Data Model & Schema

### Task 1: Install workpool component and create convex.config.ts

**Files:**
- Create: `app/backend/convex/convex.config.ts`
- Modify: `app/backend/package.json`

- [ ] **Step 1: Install @convex-dev/workpool**

```bash
cd app/backend && pnpm add @convex-dev/workpool
```

- [ ] **Step 2: Create convex.config.ts**

```typescript
// app/backend/convex/convex.config.ts
import { defineApp } from "convex/server";
import workpool from "@convex-dev/workpool/convex.config";

const app = defineApp();
app.use(workpool, { name: "extractionPool" });

export default app;
```

- [ ] **Step 3: Run convex dev to generate component bindings**

```bash
cd app/backend && pnpm exec convex dev
```

Wait for it to generate `_generated/` files with workpool component bindings. Verify `_generated/api.d.ts` references the workpool component. Stop the dev server after generation.

- [ ] **Step 4: Commit**

```bash
git add app/backend/convex/convex.config.ts app/backend/package.json app/backend/pnpm-lock.yaml
git commit -m "chore: install @convex-dev/workpool and create convex.config.ts"
```

---

### Task 2: Update schema with new tables and modified fields

**Files:**
- Modify: `app/backend/convex/schema.ts`

- [ ] **Step 1: Add rawFiles table to schema**

Add after the `sources` table definition in `schema.ts`:

```typescript
// Raw files uploaded from local sources (stored in Convex file storage)
rawFiles: defineTable({
  source: v.string(),           // e.g., "claude-transcripts", "git-history"
  sourceId: v.string(),         // unique per file, e.g., "claude:session-uuid"
  storageId: v.id("_storage"),  // reference to Convex file storage
  projectPath: v.optional(v.string()),
  projectName: v.optional(v.string()),
  sessionId: v.optional(v.string()),
  fileName: v.string(),
  localFileSize: v.number(),
  localModifiedAt: v.number(),
  timestamp: v.number(),        // file mtime at upload
  status: v.union(
    v.literal("uploaded"),
    v.literal("extracting"),
    v.literal("extracted"),
    v.literal("failed")
  ),
  extractionResults: v.optional(v.array(v.object({
    extractorName: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("running"),
      v.literal("completed"),
      v.literal("failed")
    ),
    entryCount: v.number(),
    error: v.optional(v.string()),
  }))),
})
  .index("by_source_sourceId", ["source", "sourceId"])
  .index("by_source_status", ["source", "status"])
  .index("by_source_timestamp", ["source", "timestamp"]),
```

- [ ] **Step 2: Add extractors table to schema**

Add after `rawFiles`:

```typescript
// Registry of available extractors per source
extractors: defineTable({
  source: v.string(),
  name: v.string(),
  displayName: v.string(),
  description: v.string(),
  type: v.union(v.literal("mechanical"), v.literal("ai")),
  autoRun: v.boolean(),
  enabled: v.boolean(),
  parserName: v.optional(v.string()),
  promptTemplate: v.optional(v.string()),
})
  .index("by_source", ["source"])
  .index("by_source_name", ["source", "name"]),
```

- [ ] **Step 3: Add rawFileId and extractorName to knowledgeEntries**

Add these two fields to the `knowledgeEntries` table definition, after the `embedding` field:

```typescript
rawFileId: v.optional(v.id("rawFiles")),
extractorName: v.optional(v.string()),
```

Add a new index after `by_timestamp`:

```typescript
.index("by_rawFile_extractor", ["rawFileId", "extractorName"])
```

- [ ] **Step 4: Push schema changes**

```bash
cd app/backend && pnpm exec convex dev
```

Verify the schema push succeeds. Check that all 8 tables are listed (knowledgeEntries, knowledgeItems, contentItems, digests, sources, cronConfig, rawFiles, extractors).

- [ ] **Step 5: Commit**

```bash
git add app/backend/convex/schema.ts
git commit -m "feat: add rawFiles and extractors tables, extend knowledgeEntries schema"
```

---

### Task 3: Implement rawFiles mutations and queries

**Files:**
- Create: `app/backend/convex/rawFiles.ts`

- [ ] **Step 1: Create rawFiles.ts with queries and mutations**

```typescript
// app/backend/convex/rawFiles.ts
import { v } from "convex/values";
import { query, mutation, internalMutation } from "./_generated/server";

const extractionResultValidator = v.object({
  extractorName: v.string(),
  status: v.union(
    v.literal("pending"),
    v.literal("running"),
    v.literal("completed"),
    v.literal("failed")
  ),
  entryCount: v.number(),
  error: v.optional(v.string()),
});

export const getBySourceId = query({
  args: {
    source: v.string(),
    sourceId: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    return await ctx.db
      .query("rawFiles")
      .withIndex("by_source_sourceId", (q) =>
        q.eq("source", args.source).eq("sourceId", args.sourceId)
      )
      .unique();
  },
});

export const list = query({
  args: {
    source: v.string(),
    limit: v.optional(v.number()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const limit = args.limit ?? 50;
    return await ctx.db
      .query("rawFiles")
      .withIndex("by_source_timestamp", (q) => q.eq("source", args.source))
      .order("desc")
      .take(limit);
  },
});

export const create = mutation({
  args: {
    source: v.string(),
    sourceId: v.string(),
    storageId: v.id("_storage"),
    projectPath: v.optional(v.string()),
    projectName: v.optional(v.string()),
    sessionId: v.optional(v.string()),
    fileName: v.string(),
    localFileSize: v.number(),
    localModifiedAt: v.number(),
    timestamp: v.number(),
  },
  returns: v.id("rawFiles"),
  handler: async (ctx, args) => {
    const id = await ctx.db.insert("rawFiles", {
      ...args,
      status: "uploaded" as const,
      extractionResults: [],
    });
    return id;
  },
});

export const reupload = mutation({
  args: {
    id: v.id("rawFiles"),
    storageId: v.id("_storage"),
    localFileSize: v.number(),
    localModifiedAt: v.number(),
    timestamp: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      storageId: args.storageId,
      localFileSize: args.localFileSize,
      localModifiedAt: args.localModifiedAt,
      timestamp: args.timestamp,
      status: "uploaded" as const,
      extractionResults: [],
    });
    return null;
  },
});

export const updateExtractionResult = internalMutation({
  args: {
    rawFileId: v.id("rawFiles"),
    extractorName: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("running"),
      v.literal("completed"),
      v.literal("failed")
    ),
    entryCount: v.number(),
    error: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const rawFile = await ctx.db.get(args.rawFileId);
    if (!rawFile) return null;

    const results = (rawFile.extractionResults ?? []).map((r) =>
      r.extractorName === args.extractorName
        ? {
            extractorName: args.extractorName,
            status: args.status,
            entryCount: args.entryCount,
            error: args.error,
          }
        : r
    );

    // Check if all extractors are done
    const allDone = results.every(
      (r) => r.status === "completed" || r.status === "failed"
    );
    const anyFailed = results.some((r) => r.status === "failed");

    await ctx.db.patch(args.rawFileId, {
      extractionResults: results,
      ...(allDone ? { status: anyFailed ? ("failed" as const) : ("extracted" as const) } : {}),
    });
    return null;
  },
});

export const setExtracting = internalMutation({
  args: {
    rawFileId: v.id("rawFiles"),
    extractionResults: v.array(extractionResultValidator),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.rawFileId, {
      status: "extracting" as const,
      extractionResults: args.extractionResults,
    });
    return null;
  },
});

export const generateUploadUrl = mutation({
  args: {},
  returns: v.string(),
  handler: async (ctx) => {
    return await ctx.storage.generateUploadUrl();
  },
});

export const countBySource = query({
  args: { source: v.string() },
  returns: v.number(),
  handler: async (ctx, args) => {
    const files = await ctx.db
      .query("rawFiles")
      .withIndex("by_source_sourceId", (q) => q.eq("source", args.source))
      .collect();
    return files.length;
  },
});
```

- [ ] **Step 2: Verify it compiles**

```bash
cd app/backend && pnpm exec convex dev
```

Check for no type errors.

- [ ] **Step 3: Commit**

```bash
git add app/backend/convex/rawFiles.ts
git commit -m "feat: add rawFiles queries and mutations"
```

---

### Task 4: Implement extractors table with seed data

**Files:**
- Create: `app/backend/convex/extractors.ts`

- [ ] **Step 1: Create extractors.ts**

```typescript
// app/backend/convex/extractors.ts
import { v } from "convex/values";
import { query, mutation } from "./_generated/server";

export const list = query({
  args: { source: v.optional(v.string()) },
  returns: v.any(),
  handler: async (ctx, args) => {
    if (args.source) {
      return await ctx.db
        .query("extractors")
        .withIndex("by_source", (q) => q.eq("source", args.source!))
        .collect();
    }
    return await ctx.db.query("extractors").collect();
  },
});

export const getBySourceName = query({
  args: {
    source: v.string(),
    name: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    return await ctx.db
      .query("extractors")
      .withIndex("by_source_name", (q) =>
        q.eq("source", args.source).eq("name", args.name)
      )
      .unique();
  },
});

export const getAutoRunForSource = query({
  args: { source: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => {
    const all = await ctx.db
      .query("extractors")
      .withIndex("by_source", (q) => q.eq("source", args.source))
      .collect();
    return all.filter((e) => e.autoRun && e.enabled);
  },
});

export const seed = mutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const extractorDefs = [
      {
        source: "claude-transcripts",
        name: "project-work-summary",
        displayName: "Project Work Summary",
        description:
          "Strips tool calls, keeps human/assistant conversation text. Derives title from first message, tags from project path.",
        type: "mechanical" as const,
        autoRun: true,
        enabled: true,
        parserName: "claude-strip-tools",
      },
      {
        source: "claude-transcripts",
        name: "engineering-decisions",
        displayName: "Engineering Decisions",
        description:
          "Identifies architectural choices, technology decisions, tradeoffs, and engineering practices discussed in conversations.",
        type: "ai" as const,
        autoRun: false,
        enabled: true,
        promptTemplate:
          "Analyze this Claude Code conversation transcript. Identify and extract:\n1. Architectural decisions made (with context and reasoning)\n2. Technology choices (libraries, frameworks, patterns chosen)\n3. Tradeoffs discussed (what was considered and why)\n4. Engineering practices followed or established\n\nFor each decision, provide:\n- A clear title summarizing the decision\n- The context and alternatives considered\n- The reasoning behind the choice\n\nRespond with a JSON array of objects: [{\"title\": \"...\", \"content\": \"...\", \"tags\": [\"...\"]}]",
      },
    ];

    for (const def of extractorDefs) {
      const existing = await ctx.db
        .query("extractors")
        .withIndex("by_source_name", (q) =>
          q.eq("source", def.source).eq("name", def.name)
        )
        .unique();

      if (!existing) {
        await ctx.db.insert("extractors", def);
      }
    }
    return null;
  },
});
```

- [ ] **Step 2: Verify and push**

```bash
cd app/backend && pnpm exec convex dev
```

- [ ] **Step 3: Seed the extractors table**

Run the seed function once via the Convex dashboard or CLI:

```bash
cd app/backend && pnpm exec convex run extractors:seed
```

- [ ] **Step 4: Commit**

```bash
git add app/backend/convex/extractors.ts
git commit -m "feat: add extractors config table with seed data"
```

---

### Task 5: Add new queries to knowledgeEntries.ts

**Files:**
- Modify: `app/backend/convex/knowledgeEntries.ts`

- [ ] **Step 1: Add listByRawFile query**

Add after the existing `getRecent` query:

```typescript
export const getById = query({
  args: { id: v.id("knowledgeEntries") },
  returns: v.any(),
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

export const listByRawFile = query({
  args: {
    rawFileId: v.id("rawFiles"),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    return await ctx.db
      .query("knowledgeEntries")
      .withIndex("by_rawFile_extractor", (q) =>
        q.eq("rawFileId", args.rawFileId)
      )
      .collect();
  },
});

export const listBySourceAndExtractor = query({
  args: {
    source: v.string(),
    extractorName: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const limit = args.limit ?? 50;
    const entries = await ctx.db
      .query("knowledgeEntries")
      .withIndex("by_source", (q) => q.eq("source", args.source))
      .order("desc")
      .take(limit);

    if (args.extractorName) {
      return entries.filter((e: any) => e.extractorName === args.extractorName);
    }
    return entries;
  },
});
```

- [ ] **Step 2: Update the upsert mutation args to accept new fields**

Add `rawFileId` and `extractorName` to the `create` and `upsert` mutation args:

```typescript
rawFileId: v.optional(v.id("rawFiles")),
extractorName: v.optional(v.string()),
```

Add them to the `upsert` handler's patch call and the insert call so they are persisted.

- [ ] **Step 3: Verify**

```bash
cd app/backend && pnpm exec convex dev
```

- [ ] **Step 4: Commit**

```bash
git add app/backend/convex/knowledgeEntries.ts
git commit -m "feat: add rawFile/extractor queries and fields to knowledgeEntries"
```

---

### Task 6: Implement the extraction pipeline

**Files:**
- Create: `app/backend/convex/extraction.ts`

- [ ] **Step 1: Create extraction.ts with workpool, parser, and action**

First, create `extractionPool.ts` — this file does NOT use `"use node"` so mutations in other files can import the workpool instance:

```typescript
// app/backend/convex/extractionPool.ts
import { Workpool } from "@convex-dev/workpool";
import { components, internal } from "./_generated/api";
import { v } from "convex/values";

export const extractionPool = new Workpool(components.extractionPool, {
  maxParallelism: 5,
  retryActionsByDefault: true,
  defaultRetryBehavior: {
    maxAttempts: 3,
    initialBackoffMs: 1000,
    base: 2,
  },
  logLevel: "INFO",
});

// onComplete handler — uses defineOnComplete (produces an internalMutation)
export const handleExtractionComplete = extractionPool.defineOnComplete({
  context: v.object({
    rawFileId: v.id("rawFiles"),
    extractorName: v.string(),
  }),
  handler: async (ctx, { workId, context, result }) => {
    const { rawFileId, extractorName } = context;
    const rawFile = await ctx.db.get(rawFileId);
    if (!rawFile) return;

    // Update this extractor's result
    const results = (rawFile.extractionResults ?? []).map((r) =>
      r.extractorName === extractorName
        ? {
            extractorName,
            status:
              result.kind === "success"
                ? ("completed" as const)
                : ("failed" as const),
            entryCount:
              result.kind === "success"
                ? (result.returnValue?.entryCount ?? 0)
                : 0,
            error:
              result.kind === "failed" ? result.error : undefined,
          }
        : r
    );

    // Check if all extractors are done
    const allDone = results.every(
      (r) => r.status === "completed" || r.status === "failed"
    );
    const anyFailed = results.some((r) => r.status === "failed");

    await ctx.db.patch(rawFileId, {
      extractionResults: results,
      ...(allDone
        ? { status: anyFailed ? ("failed" as const) : ("extracted" as const) }
        : {}),
    });
  },
});
```

Then create `extraction.ts` with `"use node"` for the action only:

```typescript
// app/backend/convex/extraction.ts
"use node";

import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import { v } from "convex/values";

// ---------------------------------------------------------------------------
// Mechanical parser: claude-strip-tools
// ---------------------------------------------------------------------------

interface ParsedEntry {
  title: string;
  content: string;
  tags: string[];
  metadata: Record<string, unknown>;
}

const MAX_CONTENT_LENGTH = 50_000;
const MAX_TITLE_LENGTH = 120;

function parseClaudeStripTools(
  rawContent: string,
  projectPath?: string,
  projectName?: string
): ParsedEntry {
  const lines = rawContent.split("\n");
  const messages: { role: string; text: string }[] = [];
  let sessionId: string | null = null;
  let gitBranch: string | null = null;
  let slug: string | null = null;
  let firstTimestamp: string | null = null;

  for (const line of lines) {
    if (!line.trim()) continue;

    let record: any;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }

    // Capture metadata
    if (!sessionId && record.sessionId) sessionId = record.sessionId;
    if (!gitBranch && record.gitBranch) gitBranch = record.gitBranch;
    if (!slug && record.slug) slug = record.slug;
    if (!firstTimestamp && record.timestamp) firstTimestamp = record.timestamp;

    // Only user and assistant messages
    if (record.type !== "user" && record.type !== "assistant") continue;
    if (record.isMeta) continue;
    if (record.isSidechain) continue;

    const msg = record.message;
    if (!msg || !msg.content) continue;

    let text = "";
    if (typeof msg.content === "string") {
      text = msg.content;
    } else if (Array.isArray(msg.content)) {
      // For user messages: skip tool_result blocks
      // For assistant messages: skip tool_use blocks
      const textBlocks = msg.content.filter((block: any) => {
        if (block.type === "text" && block.text) return true;
        return false;
      });
      text = textBlocks.map((b: any) => b.text).join("\n");
    }

    if (!text.trim()) continue;

    const role = record.type === "user" ? "Human" : "Assistant";
    messages.push({ role, text: text.trim() });
  }

  // Derive title from first human message
  const firstHuman = messages.find((m) => m.role === "Human");
  let title = firstHuman
    ? firstHuman.text.replace(/\n/g, " ").replace(/\s+/g, " ").trim()
    : "Claude Code conversation";
  if (title.length > MAX_TITLE_LENGTH) {
    title = title.slice(0, MAX_TITLE_LENGTH - 3) + "...";
  }

  // Format content
  const parts: string[] = [];
  if (projectPath) parts.push(`Project: ${projectPath}\n`);
  for (const msg of messages) {
    parts.push(`### ${msg.role}\n\n${msg.text}\n`);
  }
  let content = parts.join("\n---\n\n");
  if (content.length > MAX_CONTENT_LENGTH) {
    content = content.slice(0, MAX_CONTENT_LENGTH - 20) + "\n\n[truncated]";
  }

  // Derive tags
  const tags = ["claude-code", "conversation"];
  if (projectName) tags.push(projectName);

  return {
    title,
    content,
    tags,
    metadata: {
      sessionId,
      gitBranch,
      slug,
      messageCount: messages.length,
      projectPath,
    },
  };
}

// ---------------------------------------------------------------------------
// Parser registry
// ---------------------------------------------------------------------------

const mechanicalParsers: Record<
  string,
  (raw: string, projectPath?: string, projectName?: string) => ParsedEntry
> = {
  "claude-strip-tools": parseClaudeStripTools,
};

// ---------------------------------------------------------------------------
// Generic extractor action
// ---------------------------------------------------------------------------

export const runExtractor = internalAction({
  args: {
    rawFileId: v.id("rawFiles"),
    extractorName: v.string(),
  },
  returns: v.object({ entryCount: v.number() }),
  handler: async (ctx, args) => {
    // 1. Read raw file record
    const rawFile = await ctx.runQuery(internal.rawFiles.getById, {
      id: args.rawFileId,
    });
    if (!rawFile) throw new Error(`Raw file not found: ${args.rawFileId}`);

    // 2. Read extractor config
    const extractor = await ctx.runQuery(internal.extractors.getBySourceNameInternal, {
      source: rawFile.source,
      name: args.extractorName,
    });
    if (!extractor) throw new Error(`Extractor not found: ${args.extractorName}`);

    // 3. Fetch raw file content from storage
    const blob = await ctx.storage.get(rawFile.storageId);
    if (!blob) throw new Error(`File not found in storage: ${rawFile.storageId}`);
    const rawContent = await blob.text();

    // 4. Dispatch based on type
    let entryCount = 0;

    if (extractor.type === "mechanical" && extractor.parserName) {
      const parser = mechanicalParsers[extractor.parserName];
      if (!parser) throw new Error(`Unknown parser: ${extractor.parserName}`);

      const parsed = parser(rawContent, rawFile.projectPath ?? undefined, rawFile.projectName ?? undefined);

      // 5. Upsert knowledge entry
      await ctx.runMutation(internal.knowledgeEntries.upsertFromExtractor, {
        source: rawFile.source,
        sourceId: `${rawFile.sourceId}:${args.extractorName}`,
        title: parsed.title,
        content: parsed.content,
        tags: parsed.tags,
        timestamp: rawFile.timestamp,
        metadata: parsed.metadata,
        rawFileId: args.rawFileId,
        extractorName: args.extractorName,
      });
      entryCount = 1;
    } else if (extractor.type === "ai") {
      // AI extraction — to be implemented in Phase 4
      throw new Error("AI extraction not yet implemented");
    }

    // Do NOT update extraction status here — the onComplete handler in
    // extractionPool.ts handles status transitions for both success and failure.
    return { entryCount };
  },
});
```

**Note:** This file uses `"use node"` for the action runtime. The workpool instance and `onComplete` handler live in `extractionPool.ts` (without `"use node"`) so that mutations in `rawFiles.ts` can import and use `extractionPool.enqueueAction`.

- [ ] **Step 2: Add internal queries needed by extraction.ts**

Add to `rawFiles.ts`:

```typescript
import { internalQuery } from "./_generated/server";

export const getById = internalQuery({
  args: { id: v.id("rawFiles") },
  returns: v.any(),
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});
```

Add to `extractors.ts`:

```typescript
import { internalQuery } from "./_generated/server";

export const getBySourceNameInternal = internalQuery({
  args: {
    source: v.string(),
    name: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    return await ctx.db
      .query("extractors")
      .withIndex("by_source_name", (q) =>
        q.eq("source", args.source).eq("name", args.name)
      )
      .unique();
  },
});
```

Add to `knowledgeEntries.ts` — a new internal mutation for the extractor to upsert entries:

```typescript
import { internalMutation } from "./_generated/server";

export const upsertFromExtractor = internalMutation({
  args: {
    source: v.string(),
    sourceId: v.string(),
    title: v.string(),
    content: v.string(),
    tags: v.optional(v.array(v.string())),
    timestamp: v.number(),
    metadata: v.optional(v.any()),
    rawFileId: v.id("rawFiles"),
    extractorName: v.string(),
  },
  returns: v.id("knowledgeEntries"),
  handler: async (ctx, args) => {
    // Look up by rawFileId + extractorName for dedup
    const existing = await ctx.db
      .query("knowledgeEntries")
      .withIndex("by_rawFile_extractor", (q) =>
        q.eq("rawFileId", args.rawFileId).eq("extractorName", args.extractorName)
      )
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        title: args.title,
        content: args.content,
        tags: args.tags,
        timestamp: args.timestamp,
        metadata: args.metadata,
      });
      return existing._id;
    }

    return await ctx.db.insert("knowledgeEntries", args);
  },
});
```

- [ ] **Step 3: Add extraction trigger to rawFiles.create**

Update the `rawFiles.create` mutation to trigger extraction after insert. Add this import at the top of `rawFiles.ts`:

```typescript
import { api, internal } from "./_generated/api";
```

Add this import at the top of `rawFiles.ts`:

```typescript
import { extractionPool, handleExtractionComplete } from "./extractionPool";
```

Then update the `create` handler to enqueue extractors via the workpool:

```typescript
handler: async (ctx, args) => {
  // Insert the raw file record
  const id = await ctx.db.insert("rawFiles", {
    ...args,
    status: "uploaded" as const,
    extractionResults: [],
  });

  // Query auto-run extractors for this source
  const extractors = await ctx.db
    .query("extractors")
    .withIndex("by_source", (q) => q.eq("source", args.source))
    .collect();
  const autoRunExtractors = extractors.filter((e) => e.autoRun && e.enabled);

  if (autoRunExtractors.length > 0) {
    // Initialize extraction results
    const extractionResults = autoRunExtractors.map((e) => ({
      extractorName: e.name,
      status: "pending" as const,
      entryCount: 0,
    }));

    await ctx.db.patch(id, {
      status: "extracting" as const,
      extractionResults,
    });

    // Enqueue via workpool for retries and parallelism control
    for (const ext of autoRunExtractors) {
      await extractionPool.enqueueAction(
        ctx,
        internal.extraction.runExtractor,
        { rawFileId: id, extractorName: ext.name },
        {
          onComplete: handleExtractionComplete,
          context: { rawFileId: id, extractorName: ext.name },
        }
      );
    }
  }

  return id;
},
```

- [ ] **Step 4: Also update reupload to re-trigger extraction**

Apply the same extraction trigger logic to the `reupload` handler — after patching, query auto-run extractors and enqueue them.

- [ ] **Step 5: Verify the full pipeline compiles**

```bash
cd app/backend && pnpm exec convex dev
```

Fix any type errors. The key things to verify:
- `extraction.ts` compiles with workpool import
- Internal queries/mutations are properly referenced
- Schema changes are accepted

- [ ] **Step 6: Commit**

```bash
git add app/backend/convex/extraction.ts app/backend/convex/rawFiles.ts app/backend/convex/extractors.ts app/backend/convex/knowledgeEntries.ts
git commit -m "feat: implement extraction pipeline with workpool and mechanical parser"
```

---

## Chunk 2: Upload Script & Migration

### Task 7: Rewrite ingest-claude-transcripts.ts to upload-only

**Files:**
- Modify: `app/feynman-lib/scripts/ingest-claude-transcripts.ts`
- Modify: `app/feynman-lib/scripts/shared/convex-client.ts`

- [ ] **Step 1: Update shared/convex-client.ts with upload helpers**

Add these functions to the existing file:

```typescript
export async function generateUploadUrl(client: ConvexHttpClient): Promise<string> {
  return await client.mutation("rawFiles:generateUploadUrl" as any, {});
}

export async function getRawFileBySourceId(
  client: ConvexHttpClient,
  source: string,
  sourceId: string
): Promise<any> {
  return await client.query("rawFiles:getBySourceId" as any, { source, sourceId });
}

export async function createRawFile(
  client: ConvexHttpClient,
  args: {
    source: string;
    sourceId: string;
    storageId: string;
    projectPath?: string;
    projectName?: string;
    sessionId?: string;
    fileName: string;
    localFileSize: number;
    localModifiedAt: number;
    timestamp: number;
  }
): Promise<string> {
  return await client.mutation("rawFiles:create" as any, args);
}

export async function reuploadRawFile(
  client: ConvexHttpClient,
  args: {
    id: string;
    storageId: string;
    localFileSize: number;
    localModifiedAt: number;
    timestamp: number;
  }
): Promise<void> {
  await client.mutation("rawFiles:reupload" as any, args);
}
```

- [ ] **Step 2: Rewrite ingest-claude-transcripts.ts**

Replace the entire file with the upload-only version:

```typescript
/**
 * Claude Code Transcripts Upload Script
 *
 * Scans ~/.claude/ for JSONL conversation files and uploads them
 * as raw files to Convex file storage. Extraction happens server-side.
 *
 * Usage:
 *   pnpm ingest:claude
 */

import "./shared/env.js";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  createConvexClient,
  generateUploadUrl,
  getRawFileBySourceId,
  createRawFile,
  reuploadRawFile,
  updateSourceLastIngested,
} from "./shared/convex-client.js";

const CLAUDE_DIR = path.join(os.homedir(), ".claude");
const PROJECTS_DIR = path.join(CLAUDE_DIR, "projects");
const SOURCE_NAME = "claude-transcripts";

/**
 * Recursively find all .jsonl files under a directory, skipping subagent dirs.
 */
function findJsonlFiles(dir: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "subagents") continue;
      results.push(...findJsonlFiles(full));
    } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      results.push(full);
    }
  }
  return results;
}

/**
 * Derive project name from the directory structure.
 * e.g., ~/.claude/projects/-Users-vinit-Tars-Development-foo/ → "foo"
 */
function deriveProjectInfo(filePath: string): {
  projectPath: string | undefined;
  projectName: string | undefined;
  sessionId: string | undefined;
} {
  const relative = path.relative(PROJECTS_DIR, filePath);
  const segments = relative.split(path.sep);

  let projectPath: string | undefined;
  let projectName: string | undefined;
  let sessionId: string | undefined;

  if (segments.length > 0 && segments[0] !== "..") {
    // First segment is the encoded project path
    const projectDir = segments[0];
    const pathSegments = projectDir.split("-").filter(Boolean);
    projectName = pathSegments[pathSegments.length - 1];
    projectPath = "/" + pathSegments.join("/");

    // If there's a UUID directory, that's the session ID
    if (segments.length > 1 && segments[1].match(/^[a-f0-9-]{36}$/)) {
      sessionId = segments[1];
    }
  }

  // Fallback: derive session ID from filename
  if (!sessionId) {
    const basename = path.basename(filePath, ".jsonl");
    if (basename.match(/^[a-f0-9-]{36}$/)) {
      sessionId = basename;
    }
  }

  return { projectPath, projectName, sessionId };
}

async function main(): Promise<void> {
  console.log("Scanning for Claude Code transcripts...\n");

  const files: string[] = [];

  if (fs.existsSync(PROJECTS_DIR)) {
    files.push(...findJsonlFiles(PROJECTS_DIR));
  }

  if (fs.existsSync(CLAUDE_DIR)) {
    const rootEntries = fs.readdirSync(CLAUDE_DIR, { withFileTypes: true });
    for (const entry of rootEntries) {
      if (
        entry.isFile() &&
        entry.name.endsWith(".jsonl") &&
        entry.name !== "history.jsonl"
      ) {
        files.push(path.join(CLAUDE_DIR, entry.name));
      }
    }
  }

  if (files.length === 0) {
    console.log("No transcript files found.");
    return;
  }

  console.log(`Found ${files.length} transcript files\n`);

  const client = createConvexClient();
  let uploaded = 0;
  let reuploaded = 0;
  let skipped = 0;
  let errors = 0;

  for (const filePath of files) {
    const fileName = path.basename(filePath);
    const sourceId = `claude:${path.basename(filePath, ".jsonl")}`;

    try {
      const stat = fs.statSync(filePath);
      const localFileSize = stat.size;
      const localModifiedAt = Math.floor(stat.mtimeMs);

      // Check if already uploaded
      const existing = await getRawFileBySourceId(client, SOURCE_NAME, sourceId);

      if (existing) {
        // Check if file changed
        if (
          existing.localFileSize === localFileSize &&
          existing.localModifiedAt === localModifiedAt
        ) {
          skipped++;
          continue;
        }

        // Re-upload changed file
        const uploadUrl = await generateUploadUrl(client);
        const fileContent = fs.readFileSync(filePath);
        const uploadResponse = await fetch(uploadUrl, {
          method: "POST",
          headers: { "Content-Type": "application/octet-stream" },
          body: fileContent,
        });
        const { storageId } = await uploadResponse.json();

        await reuploadRawFile(client, {
          id: existing._id,
          storageId,
          localFileSize,
          localModifiedAt,
          timestamp: localModifiedAt,
        });

        reuploaded++;
        console.log(`  ↻ ${fileName} (re-uploaded, size/mtime changed)`);
      } else {
        // New file — upload
        const { projectPath, projectName, sessionId } =
          deriveProjectInfo(filePath);

        const uploadUrl = await generateUploadUrl(client);
        const fileContent = fs.readFileSync(filePath);
        const uploadResponse = await fetch(uploadUrl, {
          method: "POST",
          headers: { "Content-Type": "application/octet-stream" },
          body: fileContent,
        });
        const { storageId } = await uploadResponse.json();

        await createRawFile(client, {
          source: SOURCE_NAME,
          sourceId,
          storageId,
          projectPath,
          projectName,
          sessionId,
          fileName,
          localFileSize,
          localModifiedAt,
          timestamp: localModifiedAt,
        });

        uploaded++;
        console.log(`  ✓ ${fileName}`);
      }
    } catch (err) {
      errors++;
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  ✗ ${fileName}: ${msg}`);
    }
  }

  // Update source tracking
  try {
    await updateSourceLastIngested(client, SOURCE_NAME, uploaded + reuploaded);
  } catch {
    // Non-fatal
  }

  console.log("\n--- Upload Complete ---");
  console.log(`New uploads: ${uploaded}`);
  console.log(`Re-uploads: ${reuploaded}`);
  console.log(`Skipped (unchanged): ${skipped}`);
  if (errors > 0) console.log(`Errors: ${errors}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
```

- [ ] **Step 3: Test the upload script locally**

```bash
pnpm ingest:claude
```

Expected output: Lists found transcript files, uploads new ones, shows upload count. Check the Convex dashboard to verify:
- `rawFiles` table has entries with `status: "extracting"` or `"extracted"`
- `knowledgeEntries` table has new entries with `rawFileId` and `extractorName` populated
- Convex file storage has the JSONL files

- [ ] **Step 4: Run again to verify dedup**

```bash
pnpm ingest:claude
```

Expected: All files show as "skipped (unchanged)". No new uploads.

- [ ] **Step 5: Commit**

```bash
git add app/feynman-lib/scripts/ingest-claude-transcripts.ts app/feynman-lib/scripts/shared/convex-client.ts
git commit -m "feat: rewrite claude transcript ingestion to upload-only with server-side extraction"
```

---

### Task 8: Clean up old knowledge entries

**Files:** None (Convex dashboard operation)

- [ ] **Step 1: Delete old claude-transcript entries**

Via the Convex dashboard or a one-time script, delete all `knowledgeEntries` where `source === "claude-transcripts"` AND `rawFileId` is undefined. These are the old entries created by the previous ingestion script.

This can be done via the Convex dashboard's data explorer, or by writing a temporary mutation:

```typescript
// Temporary — delete after running once
export const cleanupOldEntries = mutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const old = await ctx.db
      .query("knowledgeEntries")
      .withIndex("by_source", (q) => q.eq("source", "claude-transcripts"))
      .collect();
    let count = 0;
    for (const entry of old) {
      if (!entry.rawFileId) {
        await ctx.db.delete(entry._id);
        count++;
      }
    }
    return count;
  },
});
```

Run it: `pnpm exec convex run knowledgeEntries:cleanupOldEntries`

Then remove the temporary mutation.

- [ ] **Step 2: Commit cleanup (if added temp mutation)**

```bash
git add app/backend/convex/knowledgeEntries.ts
git commit -m "chore: clean up old knowledge entries without rawFileId"
```

---

## Chunk 3: Frontend Navigation & Sidebar

### Task 9: Restructure the sidebar with nested accordions

**Files:**
- Modify: `app/frontend/src/components/app-sidebar.tsx`

- [ ] **Step 1: Rewrite app-sidebar.tsx with accordion navigation**

Replace the entire file:

```tsx
"use client";

import { useState } from "react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubItem,
  SidebarMenuSubButton,
  SidebarMenuBadge,
  SidebarSeparator,
} from "@/components/ui/sidebar";
import {
  LayoutDashboard,
  Film,
  BookOpen,
  Settings,
  MessageSquare,
  GitBranch,
  ChevronDown,
  ChevronRight,
  ArrowRightLeft,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "@backend/convex/_generated/api";

export function AppSidebar() {
  const pathname = usePathname();
  const [knowledgeOpen, setKnowledgeOpen] = useState(true);
  const [sourcesOpen, setSourcesOpen] = useState(true);
  const [contentOpen, setContentOpen] = useState(false);

  // Fetch counts for badges
  const claudeCount = useQuery(api.rawFiles.countBySource, {
    source: "claude-transcripts",
  });
  const gitCount = useQuery(api.rawFiles.countBySource, {
    source: "git-history",
  });

  const isKnowledgeActive = pathname.startsWith("/knowledge");
  const isContentActive = pathname.startsWith("/content");

  return (
    <Sidebar>
      <SidebarHeader className="px-4 py-3">
        <Link href="/dashboard" className="flex items-center gap-2">
          <span className="text-lg font-bold">Feynman</span>
        </Link>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {/* Dashboard */}
              <SidebarMenuItem>
                <SidebarMenuButton
                  render={<Link href="/dashboard" />}
                  isActive={pathname === "/dashboard"}
                >
                  <LayoutDashboard className="h-4 w-4" />
                  <span>Dashboard</span>
                </SidebarMenuButton>
              </SidebarMenuItem>

              {/* Knowledge (accordion) */}
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={isKnowledgeActive}
                  onClick={() => setKnowledgeOpen(!knowledgeOpen)}
                >
                  <BookOpen className="h-4 w-4" />
                  <span>Knowledge</span>
                  {knowledgeOpen ? (
                    <ChevronDown className="ml-auto h-4 w-4" />
                  ) : (
                    <ChevronRight className="ml-auto h-4 w-4" />
                  )}
                </SidebarMenuButton>

                {knowledgeOpen && (
                  <SidebarMenuSub>
                    {/* Sources (nested accordion) */}
                    <SidebarMenuSubItem>
                      <SidebarMenuSubButton
                        render={<button />}
                        isActive={pathname.startsWith("/knowledge/sources")}
                        onClick={() => setSourcesOpen(!sourcesOpen)}
                      >
                        {sourcesOpen ? (
                          <ChevronDown className="h-3 w-3" />
                        ) : (
                          <ChevronRight className="h-3 w-3" />
                        )}
                        <span className="text-xs font-semibold uppercase tracking-wide text-sidebar-foreground/60">
                          Sources
                        </span>
                        {!sourcesOpen && (
                          <span className="ml-auto text-[10px] text-sidebar-foreground/40">
                            2
                          </span>
                        )}
                      </SidebarMenuSubButton>
                    </SidebarMenuSubItem>

                    {sourcesOpen && (
                      <>
                        <SidebarMenuSubItem>
                          <SidebarMenuSubButton
                            render={
                              <Link href="/knowledge/sources/claude-transcripts" />
                            }
                            isActive={pathname === "/knowledge/sources/claude-transcripts"}
                          >
                            <MessageSquare className="h-3.5 w-3.5" />
                            <span>Claude Transcripts</span>
                            {claudeCount !== undefined && (
                              <span className="ml-auto text-[10px] tabular-nums text-sidebar-foreground/50">
                                {claudeCount}
                              </span>
                            )}
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>

                        <SidebarMenuSubItem>
                          <SidebarMenuSubButton
                            render={
                              <Link href="/knowledge/sources/git-history" />
                            }
                            isActive={pathname === "/knowledge/sources/git-history"}
                          >
                            <GitBranch className="h-3.5 w-3.5" />
                            <span>Git History</span>
                            {gitCount !== undefined && (
                              <span className="ml-auto text-[10px] tabular-nums text-sidebar-foreground/50">
                                {gitCount}
                              </span>
                            )}
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                      </>
                    )}

                    <SidebarSeparator />

                    {/* Pipeline */}
                    <SidebarMenuSubItem>
                      <SidebarMenuSubButton
                        render={<Link href="/knowledge/pipeline" />}
                        isActive={pathname === "/knowledge/pipeline"}
                      >
                        <ArrowRightLeft className="h-3.5 w-3.5" />
                        <span>Pipeline</span>
                      </SidebarMenuSubButton>
                    </SidebarMenuSubItem>
                  </SidebarMenuSub>
                )}
              </SidebarMenuItem>

              {/* Content (accordion) */}
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={isContentActive}
                  onClick={() => setContentOpen(!contentOpen)}
                  render={contentOpen ? undefined : <Link href="/content" />}
                >
                  <Film className="h-4 w-4" />
                  <span>Content</span>
                  {contentOpen ? (
                    <ChevronDown className="ml-auto h-4 w-4" />
                  ) : (
                    <ChevronRight className="ml-auto h-4 w-4" />
                  )}
                </SidebarMenuButton>

                {contentOpen && (
                  <SidebarMenuSub>
                    <SidebarMenuSubItem>
                      <SidebarMenuSubButton
                        render={<Link href="/content" />}
                        isActive={pathname === "/content"}
                      >
                        <span>Pipeline</span>
                      </SidebarMenuSubButton>
                    </SidebarMenuSubItem>
                  </SidebarMenuSub>
                )}
              </SidebarMenuItem>

              {/* Settings */}
              <SidebarMenuItem>
                <SidebarMenuButton
                  render={<Link href="/settings" />}
                  isActive={pathname === "/settings"}
                >
                  <Settings className="h-4 w-4" />
                  <span>Settings</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
```

- [ ] **Step 2: Verify the sidebar renders**

```bash
pnpm dev
```

Navigate to http://localhost:3000. Verify:
- Dashboard, Knowledge (with accordion), Content (with accordion), Settings are visible
- Knowledge expands to show Sources (with Claude Transcripts, Git History) and Pipeline
- Sources sub-accordion collapses/expands
- Count badges appear next to sources

- [ ] **Step 3: Commit**

```bash
git add app/frontend/src/components/app-sidebar.tsx
git commit -m "feat: restructure sidebar with nested accordion navigation"
```

---

### Task 10: Move knowledge pipeline to /knowledge/pipeline route

**Files:**
- Create: `app/frontend/src/app/(app)/knowledge/pipeline/page.tsx`
- Modify: `app/frontend/src/app/(app)/knowledge/page.tsx`

- [ ] **Step 1: Create the pipeline page at the new route**

Copy the existing `knowledge/page.tsx` content to `knowledge/pipeline/page.tsx`. The file content stays exactly the same — just move it to the new path.

- [ ] **Step 2: Create a redirect at the old knowledge route**

Replace `knowledge/page.tsx` with a redirect:

```tsx
import { redirect } from "next/navigation";

export default function KnowledgePage() {
  redirect("/knowledge/sources/claude-transcripts");
}
```

- [ ] **Step 3: Verify pipeline page works at new URL**

Navigate to http://localhost:3000/knowledge/pipeline — should show the Kanban board.
Navigate to http://localhost:3000/knowledge — should redirect to Claude transcripts.

- [ ] **Step 4: Commit**

```bash
git add app/frontend/src/app/(app)/knowledge/
git commit -m "feat: move knowledge pipeline to /knowledge/pipeline route"
```

---

### Task 11: Remove RecentEntries from dashboard

**Files:**
- Modify: `app/frontend/src/app/(app)/dashboard/page.tsx`

- [ ] **Step 1: Remove RecentEntries import and usage**

In `dashboard/page.tsx`, remove the import:
```typescript
import { RecentEntries } from "@/components/dashboard/recent-entries";
```

And remove the component usage:
```tsx
<RecentEntries />
```

Keep the `RecentEntries` component file — it may be useful elsewhere later.

- [ ] **Step 2: Verify dashboard**

Navigate to http://localhost:3000/dashboard. Should show PipelineSnapshot and DigestCard only.

- [ ] **Step 3: Commit**

```bash
git add app/frontend/src/app/(app)/dashboard/page.tsx
git commit -m "feat: remove RecentEntries from dashboard"
```

---

## Chunk 4: Source Detail Pages & Slide-Over

### Task 12: Create the Claude Transcripts source detail page

**Files:**
- Create: `app/frontend/src/app/(app)/knowledge/sources/claude-transcripts/page.tsx`
- Create: `app/frontend/src/components/knowledge/source-entry-list.tsx`

- [ ] **Step 1: Create the source entry list component**

```tsx
// app/frontend/src/components/knowledge/source-entry-list.tsx
"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@backend/convex/_generated/api";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";

interface SourceEntryListProps {
  source: string;
  onEntryClick: (entryId: string) => void;
  selectedEntryId?: string;
}

const extractorColors: Record<string, string> = {
  "project-work-summary": "bg-blue-500",
  "engineering-decisions": "bg-amber-500",
};

export function SourceEntryList({
  source,
  onEntryClick,
  selectedEntryId,
}: SourceEntryListProps) {
  const [extractorFilter, setExtractorFilter] = useState<string | undefined>();
  const extractors = useQuery(api.extractors.list, { source });
  const entries = useQuery(api.knowledgeEntries.listBySourceAndExtractor, {
    source,
    extractorName: extractorFilter,
    limit: 100,
  });

  if (entries === undefined) {
    return (
      <Card className="p-4">
        <p className="text-sm text-muted-foreground">Loading...</p>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {/* Filter bar */}
      <div className="flex items-center gap-2 flex-wrap">
        <select
          className="text-sm bg-background border rounded-md px-2 py-1"
          value={extractorFilter ?? ""}
          onChange={(e) =>
            setExtractorFilter(e.target.value || undefined)
          }
        >
          <option value="">All Extractors</option>
          {extractors?.map((ext: any) => (
            <option key={ext.name} value={ext.name}>
              {ext.displayName}
            </option>
          ))}
        </select>
      </div>

      {/* Entry count */}
      <p className="text-xs text-muted-foreground">
        {entries.length} entries
      </p>

      {/* Entry list */}
      {entries.length === 0 ? (
        <Card className="p-4">
          <p className="text-sm text-muted-foreground">
            No entries yet. Run the ingestion script to upload transcripts.
          </p>
        </Card>
      ) : (
        <div className="border rounded-lg divide-y">
          {entries.map((entry: any) => (
            <button
              key={entry._id}
              className={`w-full text-left px-3 py-2.5 flex items-center gap-2 hover:bg-accent/50 transition-colors ${
                selectedEntryId === entry._id ? "bg-accent" : ""
              }`}
              onClick={() => onEntryClick(entry._id)}
            >
              <div
                className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                  extractorColors[entry.extractorName ?? ""] ?? "bg-gray-500"
                }`}
              />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{entry.title}</p>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  {entry.metadata?.projectPath && (
                    <span>
                      {(entry.metadata.projectPath as string)
                        .split("/")
                        .pop()}
                    </span>
                  )}
                  {entry.extractorName && (
                    <>
                      <span>·</span>
                      <span>{entry.extractorName}</span>
                    </>
                  )}
                  <span>·</span>
                  <span>
                    {new Date(entry.timestamp).toLocaleDateString()}
                  </span>
                </div>
              </div>
              {entry.metadata?.messageCount && (
                <span className="text-[10px] text-muted-foreground shrink-0">
                  {entry.metadata.messageCount as number} msgs
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Create the Claude Transcripts page**

```tsx
// app/frontend/src/app/(app)/knowledge/sources/claude-transcripts/page.tsx
"use client";

import { useState } from "react";
import { SourceEntryList } from "@/components/knowledge/source-entry-list";
import { EntrySlideOver } from "@/components/knowledge/entry-slide-over";

export default function ClaudeTranscriptsPage() {
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Claude Transcripts</h1>
          <p className="text-sm text-muted-foreground">
            Conversations from Claude Code sessions
          </p>
        </div>
      </div>

      <SourceEntryList
        source="claude-transcripts"
        onEntryClick={(id) => setSelectedEntryId(id)}
        selectedEntryId={selectedEntryId ?? undefined}
      />

      {selectedEntryId && (
        <EntrySlideOver
          entryId={selectedEntryId}
          onClose={() => setSelectedEntryId(null)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 3: Commit (slide-over created in next task)**

Wait for Task 13 to commit together.

---

### Task 13: Create the entry slide-over panel

**Files:**
- Create: `app/frontend/src/components/knowledge/entry-slide-over.tsx`

- [ ] **Step 1: Create entry-slide-over.tsx**

```tsx
// app/frontend/src/components/knowledge/entry-slide-over.tsx
"use client";

import { useQuery, useMutation } from "convex/react";
import { api } from "@backend/convex/_generated/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";
import type { Id } from "@backend/convex/_generated/dataModel";

interface EntrySlideOverProps {
  entryId: string;
  onClose: () => void;
}

export function EntrySlideOver({ entryId, onClose }: EntrySlideOverProps) {
  const entry = useQuery(api.knowledgeEntries.getById, {
    id: entryId as Id<"knowledgeEntries">,
  });
  const promoteToKnowledge = useMutation(api.knowledgePipeline.create);

  if (!entry) {
    return (
      <div className="fixed inset-y-0 right-0 w-[480px] bg-background border-l shadow-lg z-50 p-6">
        <p className="text-sm text-muted-foreground">Loading...</p>
      </div>
    );
  }

  async function handlePromote() {
    if (!entry) return;
    await promoteToKnowledge({
      stage: "ideas",
      topic: entry.title,
      description: entry.content.slice(0, 500),
      linkedEntryIds: [entry._id as Id<"knowledgeEntries">],
      tags: entry.tags ?? [],
    });
    onClose();
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/20 z-40"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="fixed inset-y-0 right-0 w-[520px] bg-background border-l shadow-lg z-50 flex flex-col">
        {/* Header */}
        <div className="flex items-start gap-3 p-4 border-b shrink-0">
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-semibold leading-tight">
              {entry.title}
            </h2>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <span className="text-xs text-muted-foreground">
                {new Date(entry.timestamp).toLocaleString()}
              </span>
              {entry.extractorName && (
                <Badge variant="outline" className="text-[10px]">
                  {entry.extractorName}
                </Badge>
              )}
              {entry.tags?.map((tag: string) => (
                <Badge key={tag} variant="secondary" className="text-[10px]">
                  {tag}
                </Badge>
              ))}
            </div>
          </div>
          <Button variant="ghost" size="icon-sm" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Metadata */}
        {entry.metadata && (
          <div className="px-4 py-2 border-b text-xs text-muted-foreground flex gap-4 shrink-0">
            {entry.metadata.messageCount && (
              <span>{entry.metadata.messageCount as number} messages</span>
            )}
            {entry.metadata.sessionId && (
              <span>Session: {(entry.metadata.sessionId as string).slice(0, 8)}...</span>
            )}
            {entry.metadata.gitBranch && (
              <span>Branch: {entry.metadata.gitBranch as string}</span>
            )}
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-auto p-4">
          <pre className="text-sm whitespace-pre-wrap font-sans leading-relaxed">
            {entry.content}
          </pre>
        </div>

        {/* Actions */}
        <div className="border-t p-4 flex gap-2 shrink-0">
          <Button onClick={handlePromote} size="sm">
            Promote to Pipeline
          </Button>
        </div>
      </div>
    </>
  );
}
```

- [ ] **Step 2: Verify the full source detail page works**

```bash
pnpm dev
```

Navigate to http://localhost:3000/knowledge/sources/claude-transcripts. Verify:
- Entry list loads with extracted entries
- Extractor filter dropdown works
- Clicking an entry opens the slide-over panel
- Slide-over shows title, metadata, content, and "Promote to Pipeline" button
- Closing the panel works (X button and backdrop click)

- [ ] **Step 3: Commit**

```bash
git add app/frontend/src/app/(app)/knowledge/sources/ app/frontend/src/components/knowledge/source-entry-list.tsx app/frontend/src/components/knowledge/entry-slide-over.tsx
git commit -m "feat: add Claude Transcripts source page with filterable list and slide-over panel"
```

---

### Task 14: Create the raw files browser

**Files:**
- Create: `app/frontend/src/components/knowledge/raw-files-list.tsx`
- Modify: `app/frontend/src/app/(app)/knowledge/sources/claude-transcripts/page.tsx`

- [ ] **Step 1: Create raw-files-list.tsx**

```tsx
// app/frontend/src/components/knowledge/raw-files-list.tsx
"use client";

import { useQuery } from "convex/react";
import { api } from "@backend/convex/_generated/api";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";

interface RawFilesListProps {
  source: string;
}

const statusColors: Record<string, string> = {
  uploaded: "bg-yellow-500/10 text-yellow-600",
  extracting: "bg-blue-500/10 text-blue-600",
  extracted: "bg-green-500/10 text-green-600",
  failed: "bg-red-500/10 text-red-600",
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function RawFilesList({ source }: RawFilesListProps) {
  const files = useQuery(api.rawFiles.list, { source, limit: 100 });

  if (files === undefined) {
    return (
      <Card className="p-4">
        <p className="text-sm text-muted-foreground">Loading...</p>
      </Card>
    );
  }

  if (files.length === 0) {
    return (
      <Card className="p-4">
        <p className="text-sm text-muted-foreground">
          No raw files uploaded yet.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">{files.length} files</p>
      <div className="border rounded-lg divide-y">
        {files.map((file: any) => (
          <div
            key={file._id}
            className="px-3 py-2.5 flex items-center gap-3"
          >
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{file.fileName}</p>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                {file.projectName && <span>{file.projectName}</span>}
                <span>·</span>
                <span>{formatBytes(file.localFileSize)}</span>
                <span>·</span>
                <span>
                  {new Date(file.timestamp).toLocaleDateString()}
                </span>
              </div>
            </div>
            <Badge
              variant="outline"
              className={`text-[10px] ${statusColors[file.status] ?? ""}`}
            >
              {file.status}
            </Badge>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add tab toggle to Claude Transcripts page**

Update `claude-transcripts/page.tsx` to add a toggle between "Entries" and "Raw Files":

```tsx
"use client";

import { useState } from "react";
import { SourceEntryList } from "@/components/knowledge/source-entry-list";
import { EntrySlideOver } from "@/components/knowledge/entry-slide-over";
import { RawFilesList } from "@/components/knowledge/raw-files-list";

export default function ClaudeTranscriptsPage() {
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
  const [view, setView] = useState<"entries" | "raw">("entries");

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Claude Transcripts</h1>
          <p className="text-sm text-muted-foreground">
            Conversations from Claude Code sessions
          </p>
        </div>
      </div>

      {/* View toggle */}
      <div className="flex gap-1 border rounded-lg p-0.5 w-fit">
        <button
          className={`px-3 py-1 text-sm rounded-md transition-colors ${
            view === "entries"
              ? "bg-accent font-medium"
              : "text-muted-foreground hover:text-foreground"
          }`}
          onClick={() => setView("entries")}
        >
          Extracted Entries
        </button>
        <button
          className={`px-3 py-1 text-sm rounded-md transition-colors ${
            view === "raw"
              ? "bg-accent font-medium"
              : "text-muted-foreground hover:text-foreground"
          }`}
          onClick={() => setView("raw")}
        >
          Raw Files
        </button>
      </div>

      {view === "entries" ? (
        <SourceEntryList
          source="claude-transcripts"
          onEntryClick={(id) => setSelectedEntryId(id)}
          selectedEntryId={selectedEntryId ?? undefined}
        />
      ) : (
        <RawFilesList source="claude-transcripts" />
      )}

      {selectedEntryId && (
        <EntrySlideOver
          entryId={selectedEntryId}
          onClose={() => setSelectedEntryId(null)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 3: Verify**

Navigate to Claude Transcripts page. Toggle between "Extracted Entries" and "Raw Files" views. Verify both load correctly.

- [ ] **Step 4: Commit**

```bash
git add app/frontend/src/components/knowledge/raw-files-list.tsx app/frontend/src/app/(app)/knowledge/sources/claude-transcripts/page.tsx
git commit -m "feat: add raw files browser with tab toggle on source page"
```

---

### Task 15: Create Git History placeholder page

**Files:**
- Create: `app/frontend/src/app/(app)/knowledge/sources/git-history/page.tsx`

- [ ] **Step 1: Create placeholder page**

```tsx
// app/frontend/src/app/(app)/knowledge/sources/git-history/page.tsx
"use client";

import { Card } from "@/components/ui/card";

export default function GitHistoryPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Git History</h1>
        <p className="text-sm text-muted-foreground">
          Commit history from configured repositories
        </p>
      </div>
      <Card className="p-6">
        <p className="text-sm text-muted-foreground">
          Git history source is not yet configured. This will follow the same
          upload and extraction pattern as Claude Transcripts.
        </p>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add app/frontend/src/app/(app)/knowledge/sources/git-history/page.tsx
git commit -m "feat: add git history placeholder page"
```

---

## Chunk 5: AI Extraction (Phase 4)

### Task 16: Implement AI extraction path in runExtractor

**Files:**
- Modify: `app/backend/convex/extraction.ts`

- [ ] **Step 1: Add AI extraction logic to runExtractor**

In `extraction.ts`, add the AI extraction branch to the `runExtractor` handler. Replace the `throw new Error("AI extraction not yet implemented")` block:

```typescript
} else if (extractor.type === "ai" && extractor.promptTemplate) {
  // AI extraction using Claude API
  const Anthropic = (await import("@anthropic-ai/sdk")).default;
  const anthropic = new Anthropic();

  // Prepare the conversation text (use mechanical parser to get clean text)
  const cleanParser = mechanicalParsers["claude-strip-tools"];
  const parsed = cleanParser(
    rawContent,
    rawFile.projectPath ?? undefined,
    rawFile.projectName ?? undefined
  );

  // Substitute template variables
  let prompt = extractor.promptTemplate;
  prompt = prompt.replace(/\{\{content\}\}/g, parsed.content.slice(0, 30_000));
  prompt = prompt.replace(
    /\{\{projectName\}\}/g,
    rawFile.projectName ?? "unknown"
  );

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 4096,
    messages: [
      {
        role: "user",
        content: prompt,
      },
    ],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("No text response from Claude API");
  }

  // Parse JSON array response
  let decisions: Array<{ title: string; content: string; tags?: string[] }>;
  try {
    decisions = JSON.parse(textBlock.text);
  } catch {
    const match = textBlock.text.match(/\[[\s\S]*\]/);
    if (!match) throw new Error("Failed to parse AI extraction response");
    decisions = JSON.parse(match[0]);
  }

  // Create one knowledge entry per decision
  for (const decision of decisions) {
    await ctx.runMutation(internal.knowledgeEntries.upsertFromExtractor, {
      source: rawFile.source,
      sourceId: `${rawFile.sourceId}:${args.extractorName}:${decisions.indexOf(decision)}`,
      title: decision.title,
      content: decision.content,
      tags: [
        ...(decision.tags ?? []),
        "engineering-decision",
        rawFile.projectName ?? "",
      ].filter(Boolean),
      timestamp: rawFile.timestamp,
      metadata: {
        projectPath: rawFile.projectPath,
        extractedFrom: rawFile.sourceId,
      },
      rawFileId: args.rawFileId,
      extractorName: args.extractorName,
    });
  }
  entryCount = decisions.length;
}
```

- [ ] **Step 2: Add on-demand trigger mutation**

Add to `rawFiles.ts` (NOT `extraction.ts` which has `"use node"`):

```typescript
export const triggerExtractor = mutation({
  args: {
    rawFileId: v.id("rawFiles"),
    extractorName: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const rawFile = await ctx.db.get(args.rawFileId);
    if (!rawFile) throw new Error("Raw file not found");

    // Add to extraction results if not already there
    const results = [...(rawFile.extractionResults ?? [])];
    const existingIdx = results.findIndex(
      (r) => r.extractorName === args.extractorName
    );
    if (existingIdx === -1) {
      results.push({
        extractorName: args.extractorName,
        status: "pending" as const,
        entryCount: 0,
      });
    } else {
      results[existingIdx] = {
        ...results[existingIdx],
        status: "pending" as const,
        entryCount: 0,
        error: undefined,
      };
    }

    await ctx.db.patch(args.rawFileId, {
      status: "extracting" as const,
      extractionResults: results,
    });

    // Enqueue via workpool for retries
    await extractionPool.enqueueAction(
      ctx,
      internal.extraction.runExtractor,
      { rawFileId: args.rawFileId, extractorName: args.extractorName },
      {
        onComplete: handleExtractionComplete,
        context: { rawFileId: args.rawFileId, extractorName: args.extractorName },
      }
    );

    return null;
  },
});
```

- [ ] **Step 3: Add "Run AI Extractor" button to slide-over**

In `entry-slide-over.tsx`, add a button that triggers the engineering-decisions extractor on the entry's raw file. This requires knowing the `rawFileId` from the entry:

```tsx
// Add to the Actions section of the slide-over, after "Promote to Pipeline":
{entry.rawFileId && (
  <Button
    variant="outline"
    size="sm"
    onClick={async () => {
      await triggerExtractor({
        rawFileId: entry.rawFileId,
        extractorName: "engineering-decisions",
      });
    }}
  >
    Run AI Extractor
  </Button>
)}
```

Add the mutation hook at the top of the component:
```tsx
const triggerExtractor = useMutation(api.rawFiles.triggerExtractor);
```

- [ ] **Step 4: Verify end-to-end**

1. Navigate to Claude Transcripts
2. Click an entry, click "Run AI Extractor"
3. Check the Convex dashboard — should see new `knowledgeEntries` with `extractorName: "engineering-decisions"`
4. Refresh the entry list — new entries should appear with amber dots

- [ ] **Step 5: Commit**

```bash
git add app/backend/convex/extraction.ts app/frontend/src/components/knowledge/entry-slide-over.tsx
git commit -m "feat: implement AI extraction with on-demand trigger from frontend"
```

---

## Post-Implementation Checklist

After all tasks are complete, verify:

- [ ] `pnpm ingest:claude` uploads files and triggers mechanical extraction
- [ ] Sidebar shows Knowledge > Sources > Claude Transcripts with count badge
- [ ] Claude Transcripts page shows filterable entry list
- [ ] Clicking an entry opens slide-over with content and metadata
- [ ] "Promote to Pipeline" creates a knowledge pipeline item
- [ ] "Raw Files" tab shows uploaded JSONL files with status
- [ ] Re-running `pnpm ingest:claude` skips unchanged files
- [ ] "Run AI Extractor" triggers engineering-decisions extraction
- [ ] Dashboard no longer shows RecentEntries
- [ ] `/knowledge/pipeline` shows the existing Kanban board
