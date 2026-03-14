# Transcript Session Management Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add first-class project grouping, soft-delete, drag-and-drop session management, and a unified UI for Claude transcript sessions.

**Architecture:** New `projects` Convex table as the grouping entity, with `projectId` + `deleted` fields on `rawFiles`. Frontend replaces two-tab layout with a unified accordion view (drag-and-drop via `@hello-pangea/dnd`, already installed) and a unified slide-over with extractor dropdown. Cleanup script wipes Claude data for fresh re-ingestion.

**Tech Stack:** Convex (schema, mutations, queries), Next.js App Router, `@hello-pangea/dnd`, TypeScript scripts via tsx

**Spec:** `docs/superpowers/specs/2026-03-15-transcript-management-design.md`

---

## Chunk 1: Backend — Schema & Projects

### Task 1: Update Convex Schema

**Files:**
- Modify: `app/backend/convex/schema.ts`

- [ ] **Step 1: Add `projects` table to schema**

Add the new `projects` table definition after the `sources` table (before `rawFiles`):

```typescript
// In schema.ts, add after the sources table:

// Project groups for organizing raw files
projects: defineTable({
  name: v.string(),
  source: v.string(),
  order: v.optional(v.number()),
  lastActivityAt: v.number(),
  createdAt: v.number(),
})
  .index("by_source", ["source"])
  .index("by_source_order", ["source", "order"])
  .index("by_source_name", ["source", "name"]),
```

- [ ] **Step 2: Update `rawFiles` table schema**

Modify the `rawFiles` table definition to make `storageId` optional and add `projectId` + `deleted`:

```typescript
rawFiles: defineTable({
  source: v.string(),
  sourceId: v.string(),
  storageId: v.optional(v.id("_storage")),  // Changed: optional for zero-message files
  projectPath: v.optional(v.string()),
  projectName: v.optional(v.string()),
  sessionId: v.optional(v.string()),
  fileName: v.string(),
  localFileSize: v.number(),
  localModifiedAt: v.number(),
  timestamp: v.number(),
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
  projectId: v.optional(v.id("projects")),   // New: project group reference
  deleted: v.optional(v.boolean()),           // New: soft-delete flag
})
  .index("by_source_sourceId", ["source", "sourceId"])
  .index("by_source_status", ["source", "status"])
  .index("by_source_timestamp", ["source", "timestamp"])
  .index("by_projectId", ["projectId"])                   // New
  .index("by_source_deleted", ["source", "deleted"]),     // New
```

Note: `deleted` is `v.optional(v.boolean())` in the schema to avoid needing a migration for existing rows. However, all new writes must always set `deleted` explicitly to `true` or `false`. Queries that filter active rows use `.filter(q => q.neq(q.field("deleted"), true))` to handle both `false` and `undefined` (legacy rows).

- [ ] **Step 3: Deploy schema and verify**

Run: `cd app/backend && pnpm exec convex dev`

Verify the schema pushes successfully. Existing data should be unaffected since all new fields are optional.

- [ ] **Step 4: Commit**

```bash
git add app/backend/convex/schema.ts
git commit -m "feat: add projects table and projectId/deleted fields to rawFiles schema"
```

### Task 2: Create Projects Backend

**Files:**
- Create: `app/backend/convex/projects.ts`

- [ ] **Step 1: Create projects.ts with all mutations and queries**

```typescript
import { v } from "convex/values";
import { query, mutation } from "./_generated/server";

export const create = mutation({
  args: {
    name: v.string(),
    source: v.string(),
  },
  returns: v.id("projects"),
  handler: async (ctx, args) => {
    // Find max order for this source
    const existing = await ctx.db
      .query("projects")
      .withIndex("by_source", (q) => q.eq("source", args.source))
      .collect();
    const maxOrder = existing.reduce(
      (max, p) => (p.order !== undefined && p.order > max ? p.order : max),
      -1
    );

    return await ctx.db.insert("projects", {
      name: args.name,
      source: args.source,
      order: maxOrder + 1,
      lastActivityAt: Date.now(),
      createdAt: Date.now(),
    });
  },
});

export const rename = mutation({
  args: {
    projectId: v.id("projects"),
    newName: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId);
    if (!project) throw new Error("Project not found");
    await ctx.db.patch(args.projectId, { name: args.newName });
    return null;
  },
});

export const remove = mutation({
  args: {
    projectId: v.id("projects"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId);
    if (!project) throw new Error("Project not found");

    // Get all rawFiles in this project
    const rawFiles = await ctx.db
      .query("rawFiles")
      .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))
      .collect();

    // Soft-delete each rawFile and hard-delete its knowledgeEntries
    for (const rawFile of rawFiles) {
      await ctx.db.patch(rawFile._id, { deleted: true });

      // Delete associated knowledgeEntries
      const entries = await ctx.db
        .query("knowledgeEntries")
        .withIndex("by_rawFile_extractor", (q) => q.eq("rawFileId", rawFile._id))
        .collect();
      for (const entry of entries) {
        await ctx.db.delete(entry._id);
      }
    }

    // Hard-delete the project row
    await ctx.db.delete(args.projectId);
    return null;
  },
});

export const reorder = mutation({
  args: {
    projectIds: v.array(v.id("projects")),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    for (let i = 0; i < args.projectIds.length; i++) {
      await ctx.db.patch(args.projectIds[i], { order: i });
    }
    return null;
  },
});

export const listBySource = query({
  args: {
    source: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const projects = await ctx.db
      .query("projects")
      .withIndex("by_source", (q) => q.eq("source", args.source))
      .collect();

    // Sort: manually ordered projects first (by order asc), then unordered by lastActivityAt desc
    return projects.sort((a, b) => {
      const aHasOrder = a.order !== undefined;
      const bHasOrder = b.order !== undefined;
      if (aHasOrder && bHasOrder) return a.order! - b.order!;
      if (aHasOrder && !bHasOrder) return -1;
      if (!aHasOrder && bHasOrder) return 1;
      return b.lastActivityAt - a.lastActivityAt;
    });
  },
});

export const findOrCreate = mutation({
  args: {
    name: v.string(),
    source: v.string(),
  },
  returns: v.id("projects"),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("projects")
      .withIndex("by_source_name", (q) =>
        q.eq("source", args.source).eq("name", args.name)
      )
      .unique();

    if (existing) return existing._id;

    // Find max order for this source
    const allProjects = await ctx.db
      .query("projects")
      .withIndex("by_source", (q) => q.eq("source", args.source))
      .collect();
    const maxOrder = allProjects.reduce(
      (max, p) => (p.order !== undefined && p.order > max ? p.order : max),
      -1
    );

    return await ctx.db.insert("projects", {
      name: args.name,
      source: args.source,
      order: maxOrder + 1,
      lastActivityAt: Date.now(),
      createdAt: Date.now(),
    });
  },
});
```

- [ ] **Step 2: Deploy and verify**

Run: `cd app/backend && pnpm exec convex dev`

Verify the new functions appear in the Convex dashboard.

- [ ] **Step 3: Commit**

```bash
git add app/backend/convex/projects.ts
git commit -m "feat: add projects backend with CRUD, reorder, and findOrCreate"
```

### Task 3: Update RawFiles Backend

**Files:**
- Modify: `app/backend/convex/rawFiles.ts`

- [ ] **Step 1: Update `create` mutation args to accept optional `storageId`, `projectId`, and `deleted`**

In `rawFiles.ts`, update the `create` mutation's args and handler:

```typescript
export const create = mutation({
  args: {
    source: v.string(),
    sourceId: v.string(),
    storageId: v.optional(v.id("_storage")),  // Changed: optional
    projectPath: v.optional(v.string()),
    projectName: v.optional(v.string()),
    sessionId: v.optional(v.string()),
    fileName: v.string(),
    localFileSize: v.number(),
    localModifiedAt: v.number(),
    timestamp: v.number(),
    projectId: v.optional(v.id("projects")),  // New
    deleted: v.optional(v.boolean()),          // New
  },
  returns: v.id("rawFiles"),
  handler: async (ctx, args) => {
    const isDeleted = args.deleted === true;

    // Skip extraction setup for deleted files (zero-message markers)
    if (isDeleted) {
      return await ctx.db.insert("rawFiles", {
        ...args,
        status: "uploaded" as const,
        extractionResults: [],
        deleted: true,
      });
    }

    // Query auto-run extractors for this source before inserting
    const autoRunExtractors = await ctx.db
      .query("extractors")
      .withIndex("by_source", (q) => q.eq("source", args.source))
      .collect()
      .then((list) => list.filter((e) => e.autoRun && e.enabled));

    const extractionResults = autoRunExtractors.map((e) => ({
      extractorName: e.name,
      status: "pending" as const,
      entryCount: 0,
    }));

    const status = autoRunExtractors.length > 0 ? ("extracting" as const) : ("uploaded" as const);

    const rawFileId = await ctx.db.insert("rawFiles", {
      ...args,
      status,
      extractionResults,
      deleted: false,
    });

    // Enqueue a workpool action for each auto-run extractor
    for (const extractor of autoRunExtractors) {
      await extractionPool.enqueueAction(
        ctx,
        internal.extraction.runExtractor,
        { rawFileId, extractorName: extractor.name },
        {
          onComplete: internal.extractionPool.handleExtractionComplete,
          context: { rawFileId, extractorName: extractor.name },
        }
      );
    }

    return rawFileId;
  },
});
```

- [ ] **Step 2: Update `list` query to filter out deleted rows**

```typescript
export const list = query({
  args: {
    source: v.string(),
    limit: v.optional(v.number()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const limit = args.limit ?? 50;
    const all = await ctx.db
      .query("rawFiles")
      .withIndex("by_source_timestamp", (q) => q.eq("source", args.source))
      .order("desc")
      .collect();
    return all.filter((f) => f.deleted !== true).slice(0, limit);
  },
});
```

- [ ] **Step 3: Update `countBySource` to exclude deleted rows**

```typescript
export const countBySource = query({
  args: {
    source: v.string(),
  },
  returns: v.number(),
  handler: async (ctx, args) => {
    const results = await ctx.db
      .query("rawFiles")
      .withIndex("by_source_timestamp", (q) => q.eq("source", args.source))
      .collect();
    return results.filter((f) => f.deleted !== true).length;
  },
});
```

- [ ] **Step 4: Add new mutations — `moveToProject`, `softDelete`**

Add these after the existing mutations:

```typescript
export const moveToProject = mutation({
  args: {
    rawFileId: v.id("rawFiles"),
    projectId: v.id("projects"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const rawFile = await ctx.db.get(args.rawFileId);
    if (!rawFile) throw new Error("Raw file not found");

    const oldProjectId = rawFile.projectId;
    await ctx.db.patch(args.rawFileId, { projectId: args.projectId });

    // Update lastActivityAt on the new project
    await ctx.db.patch(args.projectId, { lastActivityAt: Date.now() });

    // Update lastActivityAt on the old project if it exists
    if (oldProjectId) {
      const oldProject = await ctx.db.get(oldProjectId);
      if (oldProject) {
        await ctx.db.patch(oldProjectId, { lastActivityAt: Date.now() });
      }
    }

    return null;
  },
});

export const softDelete = mutation({
  args: {
    rawFileId: v.id("rawFiles"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const rawFile = await ctx.db.get(args.rawFileId);
    if (!rawFile) throw new Error("Raw file not found");

    // Soft-delete the rawFile
    await ctx.db.patch(args.rawFileId, { deleted: true });

    // Hard-delete associated knowledgeEntries
    const entries = await ctx.db
      .query("knowledgeEntries")
      .withIndex("by_rawFile_extractor", (q) => q.eq("rawFileId", args.rawFileId))
      .collect();
    for (const entry of entries) {
      await ctx.db.delete(entry._id);
    }

    // Update lastActivityAt on the project if it exists
    if (rawFile.projectId) {
      const project = await ctx.db.get(rawFile.projectId);
      if (project) {
        await ctx.db.patch(rawFile.projectId, { lastActivityAt: Date.now() });
      }
    }

    return null;
  },
});
```

- [ ] **Step 5: Add new queries — `listByProject`, `listUngrouped`**

```typescript
export const listByProject = query({
  args: {
    projectId: v.id("projects"),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const files = await ctx.db
      .query("rawFiles")
      .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))
      .collect();
    return files
      .filter((f) => f.deleted !== true)
      .sort((a, b) => b.timestamp - a.timestamp);
  },
});

export const listUngrouped = query({
  args: {
    source: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const files = await ctx.db
      .query("rawFiles")
      .withIndex("by_source_timestamp", (q) => q.eq("source", args.source))
      .order("desc")
      .collect();
    return files.filter(
      (f) => f.deleted !== true && f.projectId === undefined
    );
  },
});
```

- [ ] **Step 6: Deploy and verify**

Run: `cd app/backend && pnpm exec convex dev`

- [ ] **Step 7: Commit**

```bash
git add app/backend/convex/rawFiles.ts
git commit -m "feat: add moveToProject, softDelete, listByProject, listUngrouped; filter deleted from queries"
```

---

## Chunk 2: Scripts — Cleanup & Ingestion

### Task 4: Create Cleanup Script

**Files:**
- Create: `app/feynman-lib/scripts/cleanup-claude-transcripts.ts`
- Modify: `app/feynman-lib/package.json`
- Modify: `package.json` (root)

- [ ] **Step 1: Create the cleanup script**

```typescript
/**
 * Claude Transcripts Cleanup Script
 *
 * Wipes all Claude transcript data (rawFiles, knowledgeEntries, storage files)
 * while preserving project groups. Useful for fresh re-ingestion.
 *
 * Usage:
 *   pnpm cleanup:claude
 *
 * Requires CONVEX_URL in app/feynman-lib/.env
 */

import "./shared/env.js";
import { createConvexClient } from "./shared/convex-client.js";

const SOURCE_NAME = "claude-transcripts";

async function main(): Promise<void> {
  console.log("Cleaning up Claude transcript data...\n");

  const client = createConvexClient();

  // Step 1: Collect storageIds from rawFiles before deleting rows
  console.log("Collecting storage file references...");
  const rawFiles: any[] = await client.query("rawFiles:list" as any, {
    source: SOURCE_NAME,
    limit: 10000,
  });

  // Also get deleted files (list filters them out)
  const allRawFiles: any[] = await client.query("rawFiles:listAll" as any, {
    source: SOURCE_NAME,
  });

  const storageIds = allRawFiles
    .filter((f: any) => f.storageId)
    .map((f: any) => f.storageId as string);
  console.log(`  Found ${allRawFiles.length} raw files (${storageIds.length} with storage)`);

  // Step 2: Delete all knowledgeEntries for this source
  console.log("Deleting knowledge entries...");
  const deletedEntries = await client.mutation("knowledgeEntries:deleteBySource" as any, {
    source: SOURCE_NAME,
  });
  console.log(`  Deleted ${deletedEntries} knowledge entries`);

  // Step 3: Delete all rawFiles for this source
  console.log("Deleting raw file records...");
  const deletedFiles = await client.mutation("rawFiles:deleteBySource" as any, {
    source: SOURCE_NAME,
  });
  console.log(`  Deleted ${deletedFiles} raw file records`);

  // Step 4: Delete storage files
  console.log("Deleting storage files...");
  let deletedStorage = 0;
  for (const storageId of storageIds) {
    try {
      await client.mutation("rawFiles:deleteStorageFile" as any, { storageId });
      deletedStorage++;
    } catch {
      // Storage file may already be gone
    }
  }
  console.log(`  Deleted ${deletedStorage} storage files`);

  console.log("\n--- Cleanup Complete ---");
  console.log("Projects have been preserved.");
  console.log("Run 'pnpm ingest:claude' to re-ingest from scratch.");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
```

- [ ] **Step 2: Add backend mutations needed by cleanup script**

In `app/backend/convex/rawFiles.ts`, add:

```typescript
export const listAll = query({
  args: {
    source: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    return await ctx.db
      .query("rawFiles")
      .withIndex("by_source_timestamp", (q) => q.eq("source", args.source))
      .collect();
  },
});

export const deleteBySource = mutation({
  args: {
    source: v.string(),
  },
  returns: v.number(),
  handler: async (ctx, args) => {
    const files = await ctx.db
      .query("rawFiles")
      .withIndex("by_source_timestamp", (q) => q.eq("source", args.source))
      .collect();
    for (const file of files) {
      await ctx.db.delete(file._id);
    }
    return files.length;
  },
});

export const deleteStorageFile = mutation({
  args: {
    storageId: v.id("_storage"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.storage.delete(args.storageId);
    return null;
  },
});
```

In `app/backend/convex/knowledgeEntries.ts`, add:

```typescript
export const deleteBySource = mutation({
  args: {
    source: v.string(),
  },
  returns: v.number(),
  handler: async (ctx, args) => {
    const entries = await ctx.db
      .query("knowledgeEntries")
      .withIndex("by_source", (q) => q.eq("source", args.source))
      .collect();
    for (const entry of entries) {
      await ctx.db.delete(entry._id);
    }
    return entries.length;
  },
});
```

- [ ] **Step 3: Add pnpm scripts**

In `app/feynman-lib/package.json`, add to `scripts`:
```json
"cleanup:claude": "tsx scripts/cleanup-claude-transcripts.ts"
```

In root `package.json`, add to `scripts`:
```json
"cleanup:claude": "pnpm --filter @feynman/lib cleanup:claude"
```

- [ ] **Step 4: Deploy and verify**

Run: `cd app/backend && pnpm exec convex dev`

- [ ] **Step 5: Commit**

```bash
git add app/feynman-lib/scripts/cleanup-claude-transcripts.ts app/feynman-lib/package.json package.json app/backend/convex/rawFiles.ts app/backend/convex/knowledgeEntries.ts
git commit -m "feat: add cleanup:claude script for fresh re-ingestion"
```

### Task 5: Update Ingestion Pipeline

**Files:**
- Modify: `app/feynman-lib/scripts/ingest-claude-transcripts.ts`
- Modify: `app/feynman-lib/scripts/shared/convex-client.ts`

- [ ] **Step 1: Add `findOrCreateProject` helper to convex-client.ts**

Add to `app/feynman-lib/scripts/shared/convex-client.ts`:

```typescript
export async function findOrCreateProject(client: ConvexHttpClient, name: string, source: string): Promise<string> {
  return await client.mutation("projects:findOrCreate" as any, { name, source });
}
```

- [ ] **Step 2: Update `createRawFile` signature to accept `projectId` and `deleted`**

Update the existing `createRawFile` function signature:

```typescript
export async function createRawFile(client: ConvexHttpClient, args: {
  source: string; sourceId: string; storageId?: string;
  projectPath?: string; projectName?: string; sessionId?: string;
  fileName: string; localFileSize: number; localModifiedAt: number; timestamp: number;
  projectId?: string; deleted?: boolean;
}): Promise<string> {
  return await client.mutation("rawFiles:create" as any, args);
}
```

- [ ] **Step 3: Update `ingest-claude-transcripts.ts` main function**

Add the import at the top:

```typescript
import {
  createConvexClient,
  updateSourceLastIngested,
  generateUploadUrl,
  getRawFileBySourceId,
  createRawFile,
  reuploadRawFile,
  findOrCreateProject,
} from "./shared/convex-client.js";
```

Update the main loop to handle deleted files, zero-message files, and project assignment:

```typescript
async function countMessages(filePath: string): Promise<number> {
  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split("\n").filter((l) => l.trim());
  let messageCount = 0;
  for (const line of lines) {
    try {
      const record = JSON.parse(line);
      if (record.type === "human" || record.type === "assistant") {
        messageCount++;
      }
    } catch {
      // skip unparseable lines
    }
  }
  return messageCount;
}

// In main(), replace the for loop body with:
for (const filePath of files) {
  const fileName = path.basename(filePath);

  try {
    const stat = fs.statSync(filePath);
    const localFileSize = stat.size;
    const localModifiedAt = Math.floor(stat.mtimeMs);
    const timestamp = localModifiedAt;

    const sourceId = deriveSourceId(filePath);
    const existing = await getRawFileBySourceId(client, SOURCE_NAME, sourceId);

    if (existing) {
      // Skip deleted files entirely
      if (existing.deleted === true) {
        skipped++;
        continue;
      }

      // Check if size and mtime match — if so, skip
      if (
        existing.localFileSize === localFileSize &&
        existing.localModifiedAt === localModifiedAt
      ) {
        skipped++;
        continue;
      }

      // File changed — re-upload (do NOT touch projectId)
      const fileContent = fs.readFileSync(filePath);
      const uploadUrl = await generateUploadUrl(client);
      const storageId = await uploadFile(uploadUrl, fileContent);

      await reuploadRawFile(client, {
        id: existing._id,
        storageId,
        localFileSize,
        localModifiedAt,
        timestamp,
      });

      reUploads++;
      console.log(`  re-uploaded: ${fileName}`);
    } else {
      // New file — check message count first
      const messageCount = await countMessages(filePath);

      if (messageCount === 0) {
        // Zero-message file — create marker row, no storage upload
        const projectPath = deriveProjectPath(filePath);
        const projectName = deriveProjectName(projectPath);
        const sessionId = deriveSessionId(filePath);

        await createRawFile(client, {
          source: SOURCE_NAME,
          sourceId,
          projectPath,
          projectName,
          sessionId,
          fileName,
          localFileSize,
          localModifiedAt,
          timestamp,
          deleted: true,
        });

        skipped++;
        console.log(`  skipped (empty): ${fileName}`);
        continue;
      }

      // Has messages — upload and create record with project
      const projectPath = deriveProjectPath(filePath);
      const projectName = deriveProjectName(projectPath);
      const sessionId = deriveSessionId(filePath);

      // Find or create project group
      let projectId: string | undefined;
      if (projectName) {
        projectId = await findOrCreateProject(client, projectName, SOURCE_NAME);
      }

      const fileContent = fs.readFileSync(filePath);
      const uploadUrl = await generateUploadUrl(client);
      const storageId = await uploadFile(uploadUrl, fileContent);

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
        timestamp,
        projectId,
        deleted: false,
      });

      newUploads++;
      console.log(`  uploaded: ${fileName}`);
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    errors++;
    console.error(`  error [${fileName}]: ${errorMsg}`);
  }
}
```

- [ ] **Step 4: Deploy backend and test ingestion**

Run cleanup then re-ingest:
```bash
pnpm cleanup:claude
pnpm ingest:claude
```

Verify in Convex dashboard:
- Projects table has entries (one per unique folder name)
- rawFiles have `projectId` set and `deleted: false`
- Zero-message files have `deleted: true` and no `storageId`

- [ ] **Step 5: Commit**

```bash
git add app/feynman-lib/scripts/ingest-claude-transcripts.ts app/feynman-lib/scripts/shared/convex-client.ts
git commit -m "feat: update ingestion to create projects, handle deleted/zero-message files"
```

---

## Chunk 3: Frontend — Unified Session View

### Task 6: Create Session List Component

This replaces `source-entry-list.tsx` with a project-based session list that queries rawFiles by project.

**Files:**
- Create: `app/frontend/src/components/knowledge/session-list.tsx`
- Modify: `app/backend/convex/knowledgeEntries.ts` (add `getTitlesByRawFileIds` query)

- [ ] **Step 0: Add batch title lookup query to knowledgeEntries.ts**

In `app/backend/convex/knowledgeEntries.ts`, add:

```typescript
export const getTitlesByRawFileIds = query({
  args: {
    rawFileIds: v.array(v.id("rawFiles")),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const result: Record<string, string> = {};
    for (const rawFileId of args.rawFileIds) {
      const entry = await ctx.db
        .query("knowledgeEntries")
        .withIndex("by_rawFile_extractor", (q) => q.eq("rawFileId", rawFileId))
        .first();
      if (entry) {
        result[rawFileId] = entry.title;
      }
    }
    return result;
  },
});
```

Deploy: `cd app/backend && pnpm exec convex dev`

- [ ] **Step 1: Create the session list component**

This component shows projects as collapsible accordions with rawFile sessions inside. No drag-and-drop yet — that comes in Task 9.

**Note on N+1 queries:** Each `ProjectAccordion` issues its own `useQuery(api.rawFiles.listByProject)` and `useQuery(api.knowledgeEntries.getTitlesByRawFileIds)`. This creates N+1 Convex subscriptions (one per project). This is acceptable for the expected project count (~10-20) and is the idiomatic Convex React pattern. If performance becomes an issue with many projects, consider a single batch query.

```typescript
"use client";

import { useState, useRef, useEffect } from "react";
import { ChevronDown, ChevronRight, Plus, MoreHorizontal } from "lucide-react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@backend/convex/_generated/api";
import type { Id } from "@backend/convex/_generated/dataModel";

interface SessionListProps {
  source: string;
  onSessionClick: (rawFile: any) => void;
  selectedSessionId?: string;
}

function formatFriendlyDate(timestamp: number): string {
  return new Date(timestamp).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

type FileStatus = "uploaded" | "extracting" | "extracted" | "failed";

function statusDotColor(status: FileStatus): string {
  switch (status) {
    case "uploaded": return "bg-yellow-500";
    case "extracting": return "bg-blue-500";
    case "extracted": return "bg-green-500";
    case "failed": return "bg-red-500";
    default: return "bg-gray-400";
  }
}

export function SessionList({
  source,
  onSessionClick,
  selectedSessionId,
}: SessionListProps) {
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
  const [renamingProject, setRenamingProject] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const projects = useQuery(api.projects.listBySource, { source });
  const ungroupedFiles = useQuery(api.rawFiles.listUngrouped, { source });
  const createProject = useMutation(api.projects.create);
  const renameProject = useMutation(api.projects.rename);
  const deleteProject = useMutation(api.projects.remove);

  const projectList = projects ?? [];
  const ungroupedList = ungroupedFiles ?? [];

  // Auto-expand all groups on first load
  const initializedRef = useRef(false);
  useEffect(() => {
    if (!initializedRef.current && projectList.length > 0) {
      setOpenGroups(new Set(projectList.map((p: any) => p._id)));
      initializedRef.current = true;
    }
  }, [projectList.length]);

  function toggleGroup(id: string) {
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleCreateProject() {
    const name = prompt("Project name:");
    if (!name?.trim()) return;
    await createProject({ name: name.trim(), source });
  }

  async function handleRenameSubmit(projectId: string) {
    if (renameValue.trim()) {
      await renameProject({
        projectId: projectId as Id<"projects">,
        newName: renameValue.trim(),
      });
    }
    setRenamingProject(null);
  }

  async function handleDeleteProject(projectId: string, projectName: string, sessionCount: number) {
    const confirmed = confirm(
      `Delete project '${projectName}' and its ${sessionCount} sessions? All transcripts will be hidden and extracted content will be removed. Transcripts can be recovered later, but extraction will need to be re-run.`
    );
    if (!confirmed) return;
    await deleteProject({ projectId: projectId as Id<"projects"> });
  }

  return (
    <div className="space-y-3">
      {/* Top bar */}
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          {projectList.length} {projectList.length === 1 ? "project" : "projects"}
        </span>
        <button
          onClick={handleCreateProject}
          className="inline-flex items-center gap-1 text-xs px-2 py-1 border rounded-md hover:bg-accent transition-colors"
        >
          <Plus className="h-3 w-3" />
          New Project
        </button>
      </div>

      {/* Project groups */}
      <div className="space-y-2">
        {projectList.map((project: any) => (
          <ProjectAccordion
            key={project._id}
            project={project}
            isOpen={openGroups.has(project._id)}
            onToggle={() => toggleGroup(project._id)}
            onSessionClick={onSessionClick}
            selectedSessionId={selectedSessionId}
            isRenaming={renamingProject === project._id}
            renameValue={renameValue}
            onStartRename={() => {
              setRenamingProject(project._id);
              setRenameValue(project.name);
            }}
            onRenameChange={setRenameValue}
            onRenameSubmit={() => handleRenameSubmit(project._id)}
            onRenameCancel={() => setRenamingProject(null)}
            onDelete={(count) => handleDeleteProject(project._id, project.name, count)}
          />
        ))}

        {/* Ungrouped section */}
        {ungroupedList.length > 0 && (
          <div className="border rounded-lg overflow-hidden">
            <button
              onClick={() => toggleGroup("ungrouped")}
              className="w-full flex items-center gap-2 px-4 py-2.5 bg-muted/30 hover:bg-muted/50 transition-colors text-left"
            >
              {openGroups.has("ungrouped") ? (
                <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              )}
              <span className="text-sm font-medium text-muted-foreground italic">
                Ungrouped
              </span>
              <span className="text-xs text-muted-foreground ml-auto">
                {ungroupedList.length} {ungroupedList.length === 1 ? "session" : "sessions"}
              </span>
            </button>
            {openGroups.has("ungrouped") && (
              <div className="divide-y">
                {ungroupedList.map((file: any) => (
                  <SessionRow
                    key={file._id}
                    file={file}
                    onClick={() => onSessionClick(file)}
                    isSelected={selectedSessionId === file._id}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {projectList.length === 0 && ungroupedList.length === 0 && (
        <div className="border rounded-lg p-6 text-center text-sm text-muted-foreground">
          No sessions found. Run ingestion to populate.
        </div>
      )}
    </div>
  );
}

// --- Sub-components ---

interface ProjectAccordionProps {
  project: any;
  isOpen: boolean;
  onToggle: () => void;
  onSessionClick: (file: any) => void;
  selectedSessionId?: string;
  isRenaming: boolean;
  renameValue: string;
  onStartRename: () => void;
  onRenameChange: (value: string) => void;
  onRenameSubmit: () => void;
  onRenameCancel: () => void;
  onDelete: (sessionCount: number) => void;
}

function ProjectAccordion({
  project,
  isOpen,
  onToggle,
  onSessionClick,
  selectedSessionId,
  isRenaming,
  renameValue,
  onStartRename,
  onRenameChange,
  onRenameSubmit,
  onRenameCancel,
  onDelete,
}: ProjectAccordionProps) {
  const files = useQuery(api.rawFiles.listByProject, {
    projectId: project._id as Id<"projects">,
  });
  const fileList = files ?? [];

  // Batch lookup of extraction titles for session display
  const titleMap = useQuery(
    api.knowledgeEntries.getTitlesByRawFileIds,
    fileList.length > 0
      ? { rawFileIds: fileList.map((f: any) => f._id) }
      : "skip"
  ) as Record<string, string> | undefined;

  return (
    <div className="border rounded-lg overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2.5 bg-muted/30 hover:bg-muted/50 transition-colors">
        <button onClick={onToggle} className="flex items-center gap-2 flex-1 text-left">
          {isOpen ? (
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          )}
          {isRenaming ? (
            <input
              autoFocus
              value={renameValue}
              onChange={(e) => onRenameChange(e.target.value)}
              onBlur={onRenameSubmit}
              onKeyDown={(e) => {
                if (e.key === "Enter") onRenameSubmit();
                if (e.key === "Escape") onRenameCancel();
              }}
              className="text-sm font-medium bg-background border rounded px-1.5 py-0.5 w-48"
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <span className="text-sm font-medium">{project.name}</span>
          )}
        </button>
        <span className="text-xs text-muted-foreground">
          {fileList.length} {fileList.length === 1 ? "session" : "sessions"}
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={(e) => { e.stopPropagation(); onStartRename(); }}
            className="text-xs text-muted-foreground hover:text-foreground px-1.5 py-0.5 rounded hover:bg-accent transition-colors"
          >
            Rename
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(fileList.length); }}
            className="text-xs text-destructive hover:text-destructive/80 px-1.5 py-0.5 rounded hover:bg-destructive/10 transition-colors"
          >
            Delete
          </button>
        </div>
      </div>

      {/* Sessions */}
      {isOpen && (
        <div className="divide-y">
          {fileList.length === 0 ? (
            <div className="px-4 py-3 text-xs text-muted-foreground italic">
              No sessions in this project
            </div>
          ) : (
            fileList.map((file: any) => (
              <SessionRow
                key={file._id}
                file={file}
                onClick={() => onSessionClick(file)}
                isSelected={selectedSessionId === file._id}
                displayTitle={titleMap?.[file._id]}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

interface SessionRowProps {
  file: any;
  onClick: () => void;
  isSelected: boolean;
  displayTitle?: string;
}

function SessionRow({ file, onClick, isSelected, displayTitle }: SessionRowProps) {
  const title = displayTitle ?? file.fileName;

  return (
    <div
      onClick={onClick}
      className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-accent/50 transition-colors ${
        isSelected ? "bg-accent" : ""
      }`}
    >
      <span className={`h-2 w-2 shrink-0 rounded-full ${statusDotColor(file.status)}`} />
      <div className="flex-1 min-w-0">
        <p className="text-sm truncate">{title}</p>
      </div>
      <span className="text-xs text-muted-foreground shrink-0">
        {formatFriendlyDate(file.timestamp)}
      </span>
    </div>
  );
}
```

- [ ] **Step 2: Verify component renders**

Run: `pnpm dev`

Open the browser and navigate to the claude-transcripts page (will wire up in Task 7).

- [ ] **Step 3: Commit**

```bash
git add app/frontend/src/components/knowledge/session-list.tsx app/backend/convex/knowledgeEntries.ts
git commit -m "feat: add SessionList component with project accordions and title lookup"
```

### Task 7: Create Unified Slide-Over Component

Replaces both `entry-slide-over.tsx` and `raw-file-viewer.tsx` with a single component.

**Files:**
- Create: `app/frontend/src/components/knowledge/session-slide-over.tsx`

- [ ] **Step 1: Create the unified slide-over**

```typescript
"use client";

import { useState, useEffect, useCallback } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@backend/convex/_generated/api";
import type { Id } from "@backend/convex/_generated/dataModel";
import ReactMarkdown from "react-markdown";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { X, ChevronDown, ChevronRight } from "lucide-react";

interface SessionSlideOverProps {
  rawFile: any;
  onClose: () => void;
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function recordSummary(record: Record<string, unknown>): string {
  const type = (record.type as string) ?? "unknown";
  const role = (record.message as { role?: string })?.role ?? "";
  const ts = record.timestamp as string | undefined;
  const parts = [type];
  if (role) parts.push(role);
  if (ts) {
    const d = new Date(ts);
    if (!isNaN(d.getTime())) {
      parts.push(
        d.toLocaleString(undefined, {
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        })
      );
    }
  }
  return parts.join(" · ");
}

export function SessionSlideOver({ rawFile, onClose }: SessionSlideOverProps) {
  const extractors = useQuery(api.extractors.list, { source: rawFile.source });
  const entries = useQuery(api.knowledgeEntries.listByRawFile, {
    rawFileId: rawFile._id as Id<"rawFiles">,
  });

  const extractorList = extractors ?? [];
  const entryList = entries ?? [];

  // View modes: extractor name or "raw"
  const [selectedView, setSelectedView] = useState<string>("");
  const [contentMode, setContentMode] = useState<"rendered" | "raw">("rendered");

  // Raw file viewing state
  const [records, setRecords] = useState<
    Array<{ index: number; summary: string; json: string }>
  >([]);
  const [rawText, setRawText] = useState("");
  const [rawLoading, setRawLoading] = useState(false);
  const [rawError, setRawError] = useState<string | null>(null);
  const [expandedRecords, setExpandedRecords] = useState<Set<number>>(new Set());

  const downloadUrl = useQuery(
    api.rawFiles.getDownloadUrl,
    rawFile.storageId
      ? { storageId: rawFile.storageId as Id<"_storage"> }
      : "skip"
  );

  // Default to first extractor when data loads
  useEffect(() => {
    if (extractorList.length > 0 && !selectedView) {
      setSelectedView(extractorList[0].name);
    }
  }, [extractorList.length]);

  // Fetch raw file content when "raw" view is selected
  useEffect(() => {
    if (selectedView !== "raw" || !downloadUrl) return;

    setRawLoading(true);
    setRawError(null);

    fetch(downloadUrl)
      .then((res) => res.text())
      .then((text) => {
        setRawText(text);
        const lines = text.split("\n").filter((l) => l.trim());
        const parsed = lines.map((line, i) => {
          try {
            const obj = JSON.parse(line);
            return { index: i, summary: recordSummary(obj), json: JSON.stringify(obj, null, 2) };
          } catch {
            return { index: i, summary: `Line ${i + 1} (parse error)`, json: line };
          }
        });
        setRecords(parsed);
        setRawLoading(false);
      })
      .catch((err) => {
        setRawError(err.message);
        setRawLoading(false);
      });
  }, [selectedView, downloadUrl]);

  const toggleRecord = useCallback((index: number) => {
    setExpandedRecords((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }, []);

  // Find the entry for the currently selected extractor
  const selectedEntry = selectedView !== "raw"
    ? entryList.find((e: any) => e.extractorName === selectedView)
    : null;

  // Derive title from the first completed extraction entry, or fall back to fileName
  const title = entryList.length > 0 ? entryList[0].title : rawFile.fileName;

  return (
    <>
      <div className="fixed inset-0 bg-black/20 z-40" onClick={onClose} />

      <div className="fixed inset-y-0 right-0 w-[600px] bg-background border-l shadow-lg z-50 flex flex-col">
        {/* Header */}
        <div className="px-5 py-4 border-b space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0 space-y-1">
              <h2 className="text-base font-semibold leading-snug truncate">
                {title}
              </h2>
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                {rawFile.sessionId && (
                  <span title={rawFile.sessionId}>
                    Session: {rawFile.sessionId.slice(0, 8)}
                  </span>
                )}
                <span>{formatDate(rawFile.timestamp)}</span>
                <span>{formatBytes(rawFile.localFileSize)}</span>
              </div>
            </div>
            <button
              onClick={onClose}
              className="shrink-0 rounded-md p-1 hover:bg-accent transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* View selector */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">View:</span>
            <select
              value={selectedView}
              onChange={(e) => {
                setSelectedView(e.target.value);
                setContentMode("rendered");
              }}
              className="text-sm border rounded-md px-2 py-1 bg-background min-w-[200px]"
            >
              {extractorList.map((ex: any) => (
                <option key={ex.name} value={ex.name}>
                  {ex.displayName}
                </option>
              ))}
              <option value="raw">Raw Transcript</option>
            </select>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {selectedView === "raw" ? (
            // Raw transcript view
            <>
              {!rawFile.storageId ? (
                <div className="flex items-center justify-center h-full">
                  <p className="text-sm text-muted-foreground">No content available</p>
                </div>
              ) : rawLoading ? (
                <div className="flex items-center justify-center h-full">
                  <p className="text-sm text-muted-foreground">Loading file...</p>
                </div>
              ) : rawError ? (
                <div className="flex items-center justify-center h-full">
                  <p className="text-sm text-destructive">Error: {rawError}</p>
                </div>
              ) : (
                <>
                  {/* Parsed/Raw toggle */}
                  <div className="px-5 py-2 border-b flex items-center gap-2">
                    <div className="inline-flex items-center gap-0.5 border rounded-md p-0.5">
                      <button
                        onClick={() => setContentMode("rendered")}
                        className={`px-2 py-0.5 text-xs rounded transition-colors ${
                          contentMode === "rendered"
                            ? "bg-accent font-medium"
                            : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        Parsed
                      </button>
                      <button
                        onClick={() => setContentMode("raw")}
                        className={`px-2 py-0.5 text-xs rounded transition-colors ${
                          contentMode === "raw"
                            ? "bg-accent font-medium"
                            : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        Raw
                      </button>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {records.length} records
                    </span>
                  </div>

                  {contentMode === "raw" ? (
                    <div className="px-5 py-4">
                      <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed">
                        {rawText}
                      </pre>
                    </div>
                  ) : (
                    <div>
                      {records.map((record) => (
                        <div key={record.index}>
                          <button
                            onClick={() => toggleRecord(record.index)}
                            className="w-full flex items-center gap-2 px-4 py-2 text-left hover:bg-accent/30 transition-colors border-b text-xs"
                          >
                            {expandedRecords.has(record.index) ? (
                              <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
                            ) : (
                              <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
                            )}
                            <span className="font-mono text-muted-foreground w-8 shrink-0">
                              {record.index + 1}
                            </span>
                            <span className="truncate">{record.summary}</span>
                          </button>
                          {expandedRecords.has(record.index) && (
                            <div className="px-4 py-2 bg-muted/20 border-b">
                              <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed overflow-x-auto">
                                {record.json}
                              </pre>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </>
          ) : (
            // Extractor view
            <>
              {selectedEntry ? (
                <>
                  {/* Rendered/Raw toggle */}
                  <div className="px-5 py-2 border-b">
                    <div className="inline-flex items-center gap-0.5 border rounded-md p-0.5">
                      <button
                        onClick={() => setContentMode("rendered")}
                        className={`px-2 py-0.5 text-xs rounded transition-colors ${
                          contentMode === "rendered"
                            ? "bg-accent font-medium"
                            : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        Rendered
                      </button>
                      <button
                        onClick={() => setContentMode("raw")}
                        className={`px-2 py-0.5 text-xs rounded transition-colors ${
                          contentMode === "raw"
                            ? "bg-accent font-medium"
                            : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        Raw
                      </button>
                    </div>
                  </div>

                  <div className="px-5 py-4">
                    {contentMode === "rendered" ? (
                      <div className="prose prose-sm dark:prose-invert max-w-none">
                        <ReactMarkdown>{selectedEntry.content}</ReactMarkdown>
                      </div>
                    ) : (
                      <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed">
                        {selectedEntry.content}
                      </pre>
                    )}
                  </div>
                </>
              ) : (
                <div className="flex items-center justify-center h-full">
                  <p className="text-sm text-muted-foreground">
                    No extraction available for this view. The extractor may not have run yet.
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add app/frontend/src/components/knowledge/session-slide-over.tsx
git commit -m "feat: add unified SessionSlideOver with extractor dropdown"
```

### Task 8: Update Page Component

Wire up the new components, replacing the old two-tab layout.

**Files:**
- Modify: `app/frontend/src/app/(app)/knowledge/sources/claude-transcripts/page.tsx`

- [ ] **Step 1: Replace the page component**

```typescript
"use client";

import { useState } from "react";
import { SessionList } from "@/components/knowledge/session-list";
import { SessionSlideOver } from "@/components/knowledge/session-slide-over";

const SOURCE = "claude-transcripts";

export default function ClaudeTranscriptsPage() {
  const [selectedFile, setSelectedFile] = useState<any | null>(null);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">Claude Transcripts</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Transcript sessions organized by project
        </p>
      </div>

      {/* Session list */}
      <SessionList
        source={SOURCE}
        onSessionClick={(file) => setSelectedFile(file)}
        selectedSessionId={selectedFile?._id}
      />

      {/* Slide-over */}
      {selectedFile && (
        <SessionSlideOver
          rawFile={selectedFile}
          onClose={() => setSelectedFile(null)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify the page works**

Run: `pnpm dev`

Navigate to Claude Transcripts page. Verify:
- Projects show as collapsible accordions
- Sessions listed within each project
- Clicking a session opens the slide-over
- Extractor dropdown switches between views
- Raw transcript view works

- [ ] **Step 3: Commit**

```bash
git add app/frontend/src/app/\(app\)/knowledge/sources/claude-transcripts/page.tsx
git commit -m "feat: replace two-tab layout with unified session view"
```

---

## Chunk 4: Frontend — Drag-and-Drop & Context Menus

### Task 9: Add Drag-and-Drop for Sessions Between Projects

Uses `@hello-pangea/dnd` (already installed) to enable dragging sessions between project groups.

**Files:**
- Modify: `app/frontend/src/components/knowledge/session-list.tsx`

- [ ] **Step 1: Add DnD imports and wrap the list**

At the top of `session-list.tsx`, add:

```typescript
import { DragDropContext, Droppable, Draggable, type DropResult } from "@hello-pangea/dnd";
```

- [ ] **Step 2: Add the DnD handler to `SessionList`**

Inside the `SessionList` component, add the drop handler and the `moveToProject` mutation:

```typescript
const moveToProject = useMutation(api.rawFiles.moveToProject);

async function handleDragEnd(result: DropResult) {
  const { draggableId, destination } = result;
  if (!destination) return;

  const targetProjectId = destination.droppableId;
  if (targetProjectId === "ungrouped") return; // Can't drop into ungrouped

  await moveToProject({
    rawFileId: draggableId as Id<"rawFiles">,
    projectId: targetProjectId as Id<"projects">,
  });
}
```

- [ ] **Step 3: Wrap the project list in DragDropContext**

Replace the `<div className="space-y-2">` wrapper around the project groups with:

```typescript
<DragDropContext onDragEnd={handleDragEnd}>
  <div className="space-y-2">
    {projectList.map((project: any) => (
      <ProjectAccordion
        key={project._id}
        project={project}
        // ... same props
      />
    ))}

    {/* Ungrouped section */}
    {ungroupedList.length > 0 && (
      <Droppable droppableId="ungrouped" isDropDisabled={true}>
        {(provided) => (
          <div ref={provided.innerRef} {...provided.droppableProps}>
            <div className="border rounded-lg overflow-hidden">
              <button
                onClick={() => toggleGroup("ungrouped")}
                className="w-full flex items-center gap-2 px-4 py-2.5 bg-muted/30 hover:bg-muted/50 transition-colors text-left"
              >
                {openGroups.has("ungrouped") ? (
                  <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                )}
                <span className="text-sm font-medium text-muted-foreground italic">Ungrouped</span>
                <span className="text-xs text-muted-foreground ml-auto">
                  {ungroupedList.length} {ungroupedList.length === 1 ? "session" : "sessions"}
                </span>
              </button>
              {openGroups.has("ungrouped") && (
                <div className="divide-y">
                  {ungroupedList.map((file: any, index: number) => (
                    <Draggable key={file._id} draggableId={file._id} index={index}>
                      {(provided, snapshot) => (
                        <div
                          ref={provided.innerRef}
                          {...provided.draggableProps}
                          {...provided.dragHandleProps}
                        >
                          <SessionRow
                            file={file}
                            onClick={() => onSessionClick(file)}
                            isSelected={selectedSessionId === file._id}
                          />
                        </div>
                      )}
                    </Draggable>
                  ))}
                </div>
              )}
            </div>
            {provided.placeholder}
          </div>
        )}
      </Droppable>
    )}
  </div>
</DragDropContext>
```

- [ ] **Step 4: Update ProjectAccordion to be a Droppable with Draggable children**

Wrap the sessions list inside each `ProjectAccordion` with `Droppable` and each `SessionRow` with `Draggable`:

```typescript
// Inside ProjectAccordion's session list:
<Droppable droppableId={project._id}>
  {(provided, snapshot) => (
    <div
      ref={provided.innerRef}
      {...provided.droppableProps}
      className={`divide-y ${snapshot.isDraggingOver ? "bg-accent/20" : ""}`}
    >
      {fileList.length === 0 ? (
        <div className="px-4 py-3 text-xs text-muted-foreground italic">
          No sessions in this project
        </div>
      ) : (
        fileList.map((file: any, index: number) => (
          <Draggable key={file._id} draggableId={file._id} index={index}>
            {(provided, snapshot) => (
              <div
                ref={provided.innerRef}
                {...provided.draggableProps}
                {...provided.dragHandleProps}
                className={snapshot.isDragging ? "shadow-lg bg-background rounded" : ""}
              >
                <SessionRow
                  file={file}
                  onClick={() => onSessionClick(file)}
                  isSelected={selectedSessionId === file._id}
                />
              </div>
            )}
          </Draggable>
        ))
      )}
      {provided.placeholder}
    </div>
  )}
</Droppable>
```

- [ ] **Step 5: Verify drag-and-drop works**

Run: `pnpm dev`

- Drag a session from one project to another
- Verify it moves correctly (Convex real-time update)
- Verify the session re-sorts by timestamp in the new project
- Verify dragging into ungrouped is disabled

- [ ] **Step 6: Commit**

```bash
git add app/frontend/src/components/knowledge/session-list.tsx
git commit -m "feat: add drag-and-drop for moving sessions between projects"
```

### Task 10: Add Context Menu with Move-To and Delete

**Files:**
- Modify: `app/frontend/src/components/knowledge/session-list.tsx`

- [ ] **Step 1: Add context menu state to SessionList**

Add state for the context menu:

```typescript
const [contextMenu, setContextMenu] = useState<{
  x: number;
  y: number;
  file: any;
} | null>(null);

const softDeleteFile = useMutation(api.rawFiles.softDelete);
```

- [ ] **Step 2: Create the ContextMenu component**

Add inside `session-list.tsx`:

```typescript
interface ContextMenuProps {
  x: number;
  y: number;
  file: any;
  projects: any[];
  onClose: () => void;
  onMoveTo: (rawFileId: string, projectId: string) => void;
  onDelete: (rawFileId: string, fileName: string) => void;
  onCreateAndMove: (rawFileId: string) => void;
}

function SessionContextMenu({
  x,
  y,
  file,
  projects,
  onClose,
  onMoveTo,
  onDelete,
  onCreateAndMove,
}: ContextMenuProps) {
  const [showMoveSubmenu, setShowMoveSubmenu] = useState(false);

  // Close on click outside
  useEffect(() => {
    function handleClick() { onClose(); }
    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, [onClose]);

  return (
    <div
      className="fixed z-[60] bg-background border rounded-lg shadow-lg py-1 min-w-[180px]"
      style={{ left: x, top: y }}
      onClick={(e) => e.stopPropagation()}
    >
      <div
        className="relative"
        onMouseEnter={() => setShowMoveSubmenu(true)}
        onMouseLeave={() => setShowMoveSubmenu(false)}
      >
        <button className="w-full text-left px-3 py-1.5 text-sm hover:bg-accent transition-colors flex items-center justify-between">
          Move to
          <ChevronRight className="h-3 w-3 text-muted-foreground" />
        </button>
        {showMoveSubmenu && (
          <div className="absolute left-full top-0 bg-background border rounded-lg shadow-lg py-1 min-w-[160px] ml-1">
            {projects
              .filter((p: any) => p._id !== file.projectId)
              .map((p: any) => (
                <button
                  key={p._id}
                  onClick={() => { onMoveTo(file._id, p._id); onClose(); }}
                  className="w-full text-left px-3 py-1.5 text-sm hover:bg-accent transition-colors"
                >
                  {p.name}
                </button>
              ))}
            <div className="border-t my-1" />
            <button
              onClick={() => { onCreateAndMove(file._id); onClose(); }}
              className="w-full text-left px-3 py-1.5 text-sm hover:bg-accent transition-colors text-muted-foreground"
            >
              + New Project...
            </button>
          </div>
        )}
      </div>
      <button
        onClick={() => { onDelete(file._id, file.fileName); onClose(); }}
        className="w-full text-left px-3 py-1.5 text-sm text-destructive hover:bg-destructive/10 transition-colors"
      >
        Delete session
      </button>
    </div>
  );
}
```

- [ ] **Step 3: Add context menu handlers to SessionList**

```typescript
async function handleContextDelete(rawFileId: string, fileName: string) {
  const confirmed = confirm(
    `Delete session '${fileName}'? The transcript will be hidden and extracted content will be removed. You can recover the transcript later, but extraction will need to be re-run.`
  );
  if (!confirmed) return;
  await softDeleteFile({ rawFileId: rawFileId as Id<"rawFiles"> });
}

async function handleContextMoveTo(rawFileId: string, projectId: string) {
  await moveToProject({
    rawFileId: rawFileId as Id<"rawFiles">,
    projectId: projectId as Id<"projects">,
  });
}

async function handleContextCreateAndMove(rawFileId: string) {
  const name = prompt("New project name:");
  if (!name?.trim()) return;
  const projectId = await createProject({ name: name.trim(), source });
  await moveToProject({
    rawFileId: rawFileId as Id<"rawFiles">,
    projectId,
  });
}
```

- [ ] **Step 4: Add ⋯ button to SessionRow and wire up context menu**

Update `SessionRow` to include a context menu trigger:

```typescript
function SessionRow({ file, onClick, isSelected, onContextMenu }: SessionRowProps & { onContextMenu?: (e: React.MouseEvent, file: any) => void }) {
  return (
    <div
      onClick={onClick}
      onContextMenu={(e) => {
        e.preventDefault();
        onContextMenu?.(e, file);
      }}
      className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-accent/50 transition-colors ${
        isSelected ? "bg-accent" : ""
      }`}
    >
      <span className={`h-2 w-2 shrink-0 rounded-full ${statusDotColor(file.status)}`} />
      <div className="flex-1 min-w-0">
        <p className="text-sm truncate">{file.fileName}</p>
      </div>
      <span className="text-xs text-muted-foreground shrink-0">
        {formatFriendlyDate(file.timestamp)}
      </span>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onContextMenu?.(e, file);
        }}
        className="shrink-0 p-1 rounded hover:bg-accent transition-colors text-muted-foreground"
      >
        <MoreHorizontal className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
```

- [ ] **Step 5: Render the context menu in SessionList**

At the bottom of the SessionList return, add:

```typescript
{contextMenu && (
  <SessionContextMenu
    x={contextMenu.x}
    y={contextMenu.y}
    file={contextMenu.file}
    projects={projectList}
    onClose={() => setContextMenu(null)}
    onMoveTo={handleContextMoveTo}
    onDelete={handleContextDelete}
    onCreateAndMove={handleContextCreateAndMove}
  />
)}
```

Pass the context menu handler down to `SessionRow`:

```typescript
onContextMenu={(e: React.MouseEvent, file: any) => {
  setContextMenu({ x: e.clientX, y: e.clientY, file });
}}
```

- [ ] **Step 6: Verify context menu and delete work**

Run: `pnpm dev`

- Right-click or click ⋯ on a session → context menu appears
- "Move to →" shows submenu with other projects
- "Delete session" shows confirmation dialog
- Moving via context menu works
- Deleting soft-deletes and removes from view

- [ ] **Step 7: Commit**

```bash
git add app/frontend/src/components/knowledge/session-list.tsx
git commit -m "feat: add context menu with move-to and delete session"
```

### Task 11: Add Project Drag-and-Drop Reordering

**Files:**
- Modify: `app/frontend/src/components/knowledge/session-list.tsx`

- [ ] **Step 1: Add project reordering**

This requires a separate `DragDropContext` or handling multiple drag types. The simpler approach: use a `type` field on the `Droppable`/`Draggable` to distinguish project reordering from session moving.

Update `handleDragEnd` to handle both:

```typescript
async function handleDragEnd(result: DropResult) {
  const { draggableId, destination, source: dragSource, type } = result;
  if (!destination) return;

  if (type === "project") {
    // Reorder projects
    const newOrder = Array.from(projectList);
    const [moved] = newOrder.splice(dragSource.index, 1);
    newOrder.splice(destination.index, 0, moved);
    await reorderProjects({
      projectIds: newOrder.map((p: any) => p._id),
    });
  } else {
    // Move session between projects
    const targetProjectId = destination.droppableId;
    if (targetProjectId === "ungrouped") return;

    await moveToProject({
      rawFileId: draggableId as Id<"rawFiles">,
      projectId: targetProjectId as Id<"projects">,
    });
  }
}
```

Add mutation:
```typescript
const reorderProjects = useMutation(api.projects.reorder);
```

- [ ] **Step 2: Wrap project list in a project-level Droppable**

```typescript
<DragDropContext onDragEnd={handleDragEnd}>
  <Droppable droppableId="project-list" type="project">
    {(provided) => (
      <div ref={provided.innerRef} {...provided.droppableProps} className="space-y-2">
        {projectList.map((project: any, index: number) => (
          <Draggable key={project._id} draggableId={project._id} index={index} type="project">
            {(provided, snapshot) => (
              <div
                ref={provided.innerRef}
                {...provided.draggableProps}
                className={snapshot.isDragging ? "shadow-lg rounded" : ""}
              >
                <ProjectAccordion
                  project={project}
                  dragHandleProps={provided.dragHandleProps}
                  // ... other props
                />
              </div>
            )}
          </Draggable>
        ))}
        {provided.placeholder}

        {/* Ungrouped stays at bottom, outside the project-level Droppable */}
      </div>
    )}
  </Droppable>

  {/* Ungrouped section outside project droppable but inside DragDropContext */}
  {ungroupedList.length > 0 && (
    /* ... ungrouped Droppable with type="session" */
  )}
</DragDropContext>
```

- [ ] **Step 3: Pass drag handle props to ProjectAccordion header**

Update `ProjectAccordionProps` to include `dragHandleProps` and apply to a drag handle element in the header:

```typescript
// In the project header div, add a drag handle:
<span {...dragHandleProps} className="cursor-grab text-muted-foreground">
  ⠿
</span>
```

- [ ] **Step 4: Verify project reordering**

Run: `pnpm dev`

- Drag project headers to reorder
- Verify the order persists (reloads maintain order)

- [ ] **Step 5: Commit**

```bash
git add app/frontend/src/components/knowledge/session-list.tsx
git commit -m "feat: add project drag-and-drop reordering"
```

---

## Chunk 5: Cleanup & Session Title Resolution

### ~~Task 12: Session Titles~~ (Integrated into Task 6)

Session title lookup via `getTitlesByRawFileIds` has been integrated into Task 6 (Step 0 + ProjectAccordion's `titleMap` query). No separate task needed.

### Task 13: Clean Up Old Components

The old components are no longer used by the page.

**Files:**
- Delete: `app/frontend/src/components/knowledge/source-entry-list.tsx`
- Delete: `app/frontend/src/components/knowledge/entry-slide-over.tsx`
- Delete: `app/frontend/src/components/knowledge/raw-files-list.tsx`
- Delete: `app/frontend/src/components/knowledge/raw-file-viewer.tsx`

- [ ] **Step 1: Check for other imports of these components**

Search the codebase for imports of the old components. If they are only used by the claude-transcripts page (which we've already updated), they can be safely deleted.

Run: `grep -r "source-entry-list\|entry-slide-over\|raw-files-list\|raw-file-viewer" app/frontend/src/ --include="*.tsx" --include="*.ts"`

- [ ] **Step 2: Delete old components if no other imports**

Only delete if the search confirms no other files import them.

- [ ] **Step 3: Remove the `cleanupOldEntries` mutation from knowledgeEntries.ts**

This temporary mutation (lines 199-218) is no longer needed.

- [ ] **Step 4: Commit**

```bash
git add -A app/frontend/src/components/knowledge/ app/backend/convex/knowledgeEntries.ts
git commit -m "chore: remove old entry/raw-file components, replaced by unified session view"
```

### Task 14: End-to-End Verification

- [ ] **Step 1: Run full cleanup and re-ingest**

```bash
pnpm cleanup:claude
pnpm ingest:claude
```

- [ ] **Step 2: Verify all features in the browser**

Run: `pnpm dev`

Checklist:
- [ ] Projects show as collapsible accordions with correct session counts
- [ ] Sessions show extraction titles (not UUIDs)
- [ ] Clicking a session opens the unified slide-over
- [ ] Extractor dropdown switches between views (Project Work Summary, Engineering Decisions, Raw Transcript)
- [ ] Rendered/Raw toggle works in both extractor and raw views
- [ ] Drag-and-drop moves sessions between projects
- [ ] Context menu (⋯) shows "Move to" and "Delete session"
- [ ] "Move to" submenu lists other projects and "New Project..."
- [ ] Delete session shows confirmation and soft-deletes
- [ ] Delete project shows confirmation and cascades
- [ ] Rename project works via inline editing
- [ ] "+ New Project" creates empty project
- [ ] Project drag-and-drop reordering works and persists
- [ ] Ungrouped section shows sessions without a project
- [ ] Re-ingestion preserves manual grouping changes

- [ ] **Step 3: Commit any fixes**

```bash
git add -A
git commit -m "fix: address issues found during end-to-end verification"
```
