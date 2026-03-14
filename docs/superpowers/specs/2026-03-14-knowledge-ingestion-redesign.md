# Knowledge Ingestion Redesign

Design spec for improving the Claude transcript ingestion system, introducing a source → extract → browse → curate architecture, and restructuring the frontend navigation.

## Overview

The current system uses local TypeScript scripts to parse Claude Code JSONL transcripts, strip internal data, and push simplified entries directly into Convex tables. This redesign introduces a layered architecture that preserves raw data, supports multiple extraction lenses on the same source, and moves processing to the Convex backend using workpools.

### Goals

- Preserve raw JSONL files in Convex file storage (no data loss, no local dependency)
- Support multiple extractors per source (different interpretations of the same raw data)
- Move extraction logic from local scripts to Convex backend (automated, reliable)
- Restructure frontend navigation with accordion-based sidebar
- Enable browsing knowledge entries by source with filtering, search, and promotion to the curation pipeline

### Out of Scope

- Git history source improvements (follows same pattern later)
- Content pipeline frontend changes (evolve later)
- Cross-source extractors
- Adding new sources from the frontend UI

## Architecture

### Pipeline Flow

```
Raw Data Sources (local machine)
    │
    ▼  (one local script per source)
Convex File Storage (raw files, one per session)
    │
    ▼  rawFiles table (metadata + storageId)
    │
    ▼  Convex Workpool (automatic for mechanical, on-demand for AI)
    │
Per-Source Extractors (configured in extractors table)
    │
    ├── Mechanical: parse + filter + structure
    └── AI: Claude API with prompt template
    │
    ▼
Knowledge Entries (browsable, searchable, tagged by source + extractor)
    │
    ▼  (manual promote from frontend)
    │
Knowledge Pipeline (existing Kanban: ideas → researching → learning → curated)
    │
    ▼
Outputs (digests, content pipeline)
```

### Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Raw storage | Convex file storage (not tables) | Files can be large; keeps raw data separate from structured entries |
| File organization | One file per session, project grouping in metadata | Incremental uploads, preserves session boundaries |
| Extractors | Per-source, configured in DB | Simpler than cross-source; each extractor understands its source format |
| Extraction execution | Convex Workpool | Parallelism, retries, completion callbacks, no manual orchestration |
| Mechanical extraction | Auto-run on upload | Fast, free, always useful |
| AI extraction | On-demand (frontend or batch trigger) | Saves tokens, user controls when to spend |
| Curation flow | Browse entries → manual promote to pipeline | Keeps pipeline clean, prevents flood of auto-generated items |
| Change detection | File size + mtime comparison | Instant (no file reading), reliable for append-only JSONL |
| Canonical source name | `"claude-transcripts"` (plural) | Matches the existing script's `SOURCE_NAME` constant |

## Migration Notes

### Existing Data

The existing ingestion script has already created `knowledgeEntries` with `source: "claude-transcripts"` and `sourceId` in the format `"claude-transcript:{basename}"`. The new system changes:

- `sourceId` format on `rawFiles` uses `"claude:{basename}"` (different from the old `knowledgeEntries.sourceId`)
- New `knowledgeEntries` will have `rawFileId` and `extractorName` fields; old entries have neither

**Migration strategy:** Delete all existing `knowledgeEntries` where `source === "claude-transcripts"` before the first run of the new pipeline. The new system will re-create them from the uploaded raw files with the correct fields. This is safe because the old entries are a lossy derivative of the raw JSONL files — the new extraction will produce better results.

### `sources` Table

The existing `sources` table tracks ingestion metadata (lastIngestedAt, entryCount). It is retained for backward compatibility and continues to be updated by the upload script. It serves a different purpose than `rawFiles` — `sources` is a per-source-type summary, while `rawFiles` is per-file. The upload script calls `sources.updateLastIngested` after each run, same as before.

## Data Model

### New Table: `rawFiles`

Stores metadata for each uploaded raw file. The actual file content lives in Convex file storage.

```typescript
rawFiles: defineTable({
  source: v.string(),           // e.g., "claude-transcripts", "git-history"
  sourceId: v.string(),         // unique per file, e.g., "claude:session-uuid"
  storageId: v.id("_storage"),  // reference to Convex file storage
  projectPath: v.optional(v.string()),  // e.g., "/Users/vinit/Tars/Content-Creation/feynman"
  projectName: v.optional(v.string()),  // derived short name, e.g., "feynman"
  sessionId: v.optional(v.string()),    // for Claude transcripts
  fileName: v.string(),
  localFileSize: v.number(),    // file size on local machine at upload time
  localModifiedAt: v.number(),  // file mtime on local machine at upload time
  timestamp: v.number(),        // file mtime at upload; set once, not refined later
  status: v.union(
    v.literal("uploaded"),
    v.literal("extracting"),
    v.literal("extracted"),
    v.literal("failed")
  ),
  extractionResults: v.optional(v.array(v.object({
    extractorName: v.string(),
    status: v.union(v.literal("pending"), v.literal("running"), v.literal("completed"), v.literal("failed")),
    entryCount: v.number(),
    error: v.optional(v.string()),
  }))),
})
  .index("by_source_sourceId", ["source", "sourceId"])
  .index("by_source_status", ["source", "status"])
  .index("by_source_timestamp", ["source", "timestamp"])
```

### New Table: `extractors`

Registry of available extractors per source. AI extractors store their prompt template here — adding a new AI extractor requires only a new DB row, no code changes.

```typescript
extractors: defineTable({
  source: v.string(),            // e.g., "claude-transcripts"
  name: v.string(),              // e.g., "project-work-summary"
  displayName: v.string(),       // e.g., "Project Work Summary"
  description: v.string(),
  type: v.union(v.literal("mechanical"), v.literal("ai")),
  autoRun: v.boolean(),          // true for mechanical, false for AI
  enabled: v.boolean(),
  parserName: v.optional(v.string()),     // for mechanical: key in parser registry
  promptTemplate: v.optional(v.string()), // for AI: Claude API prompt; uses {{content}} and {{projectName}} placeholders
})
  .index("by_source", ["source"])
  .index("by_source_name", ["source", "name"])
```

### Modified Table: `knowledgeEntries`

Add fields to link entries back to their source file and extractor.

```typescript
// Additional fields on existing knowledgeEntries table:
rawFileId: v.optional(v.id("rawFiles")),  // which raw file produced this entry
extractorName: v.optional(v.string()),     // which extractor produced this entry
```

Add index: `by_rawFileId_extractorName` on `["rawFileId", "extractorName"]` for upsert lookups and filtering.

### Seed Data: Initial Extractors

```typescript
// Claude Transcripts extractors
{
  source: "claude-transcripts",
  name: "project-work-summary",
  displayName: "Project Work Summary",
  description: "Strips tool calls, keeps human/assistant conversation text. Derives title from first message, tags from project path.",
  type: "mechanical",
  autoRun: true,
  enabled: true,
  parserName: "claude-strip-tools",
  promptTemplate: null,
}

{
  source: "claude-transcripts",
  name: "engineering-decisions",
  displayName: "Engineering Decisions",
  description: "Identifies architectural choices, technology decisions, tradeoffs, and engineering practices discussed in conversations.",
  type: "ai",
  autoRun: false,
  enabled: true,
  parserName: null,
  promptTemplate: "Analyze this Claude Code conversation transcript and identify...", // full prompt TBD during implementation
}
```

## Extraction Pipeline

### Workpool Configuration

```typescript
import { Workpool } from "@convex-dev/workpool";
import { components } from "./_generated/api";

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
```

### Generic Extractor Action

One action handles all extractors. It reads the extractor config from DB and dispatches to the right logic.

```typescript
// internal action: extraction.runExtractor
// args: { rawFileId: Id<"rawFiles">, extractorName: string }
//
// 1. Read rawFile record → get storageId
// 2. Read extractor config from extractors table by (source, extractorName)
// 3. Fetch raw file content from storage
// 4. Dispatch based on extractor.type:
//    - "mechanical" → look up parserName in registry, call parser function
//    - "ai" → call Claude API with promptTemplate + file content
// 5. Upsert knowledgeEntries (by rawFileId + extractorName)
// 6. Update rawFiles.extractionResults for this extractor
```

### Mechanical Parser Registry

Code-side map of parser functions. Adding a new mechanical extractor requires:
1. Writing a parser function
2. Registering it in the map
3. Adding a row to the `extractors` table

```typescript
const mechanicalParsers: Record<string, (content: string) => ExtractedEntry[]> = {
  "claude-strip-tools": parseClaudeStripTools,
  // future: "claude-tool-analysis": parseClaudeToolAnalysis,
  // future: "git-feature-changelog": parseGitFeatureChangelog,
};
```

### Large File Handling

Convex actions have memory and execution time limits. Most Claude Code session JSONL files are under 5MB, but long sessions can produce larger files. Mitigations:

- The `runExtractor` action streams the file content line by line rather than loading the entire file into memory
- If a file exceeds 20MB, the extractor should process it in chunks (first N lines) and mark the entry as truncated, similar to the current 50KB content limit
- The workpool's retry behavior handles transient failures from timeouts

### `claude-strip-tools` Parser

Replicates and improves the current ingestion script logic, running server-side:

1. Parse JSONL line by line
2. Filter to records where `type === "user"` or `type === "assistant"`
3. Skip records with `isMeta: true` or `isSidechain: true`
4. For user messages: extract string content (skip tool_result blocks)
5. For assistant messages: extract text content blocks (skip tool_use blocks)
6. Keep XML tags (system-reminder, etc.) — do not strip them. This is a deliberate change from the current script which strips all XML tags. The tags contain useful context (active skills, hooks, system state). Note: this will increase content size; the MAX_CONTENT_LENGTH (50KB) truncation still applies
7. Derive title from first human message (truncate to 120 chars)
8. Derive tags from project path
9. Capture metadata: messageCount, sessionId, projectPath, gitBranch, slug
10. Produce one `knowledgeEntries` record per file

### Upload Trigger Flow

Upload triggering uses a two-step pattern because Convex mutations can call `enqueueAction` on the workpool (the workpool's `enqueueAction` is itself a mutation that writes to component tables, which is allowed within a parent mutation).

When `rawFiles.create` mutation runs:

1. Insert rawFile record with `status: "uploaded"`, initialize `extractionResults` array with `{ extractorName, status: "pending", entryCount: 0 }` for each auto-run extractor
2. Query `extractors` table: `source === rawFile.source && autoRun === true && enabled === true`
3. For each matching extractor, enqueue: `extractionPool.enqueueAction(ctx, internal.extraction.runExtractor, { rawFileId, extractorName }, { onComplete: internal.extraction.handleExtractionComplete, context: { rawFileId, extractorName } })`
4. Set `status: "extracting"`

### onComplete Callback: `handleExtractionComplete`

Defined using `extractionPool.defineOnComplete()`. Handles status transitions after each extractor finishes:

```typescript
export const handleExtractionComplete = extractionPool.defineOnComplete({
  context: v.object({
    rawFileId: v.id("rawFiles"),
    extractorName: v.string(),
  }),
  handler: async (ctx, { context, result }) => {
    const { rawFileId, extractorName } = context;
    const rawFile = await ctx.db.get(rawFileId);
    if (!rawFile) return;

    // Update this extractor's result in the array
    const results = (rawFile.extractionResults ?? []).map((r) =>
      r.extractorName === extractorName
        ? {
            ...r,
            status: result.kind === "success" ? "completed" : "failed",
            entryCount: result.kind === "success" ? (result.returnValue?.entryCount ?? 0) : 0,
            error: result.kind === "failed" ? result.error : undefined,
          }
        : r
    );

    // Check if all extractors are done
    const allDone = results.every((r) => r.status === "completed" || r.status === "failed");
    const anyFailed = results.some((r) => r.status === "failed");

    await ctx.db.patch(rawFileId, {
      extractionResults: results,
      ...(allDone ? { status: anyFailed ? "failed" : "extracted" } : {}),
    });
  },
});
```

### Re-extraction on Changed Files

When the upload script detects a changed file (size or mtime differs):

1. Script calls `rawFiles.reupload` mutation with new storageId + updated size/mtime
2. Mutation replaces `storageId`, updates `localFileSize` and `localModifiedAt`
3. Resets `status` to "uploaded", clears `extractionResults`
4. Re-enqueues auto-run extractors
5. Extractors upsert entries by `rawFileId + extractorName` — updates existing entries, no duplicates

## Local Script: `ingest-claude-transcripts.ts`

Simplified to upload-only. All parsing/extraction moves to Convex.

### Flow

```
1. Scan ~/.claude/projects/ recursively for .jsonl files
   - Skip subagents/ directories
   - Skip history.jsonl
2. For each file:
   a. Derive sourceId from filename: "claude:{basename}"
   b. stat() the file → get size + mtime
   c. Query Convex: rawFiles.getBySourceId("claude-transcripts", sourceId)
   d. If exists AND localFileSize matches AND localModifiedAt matches → skip
   e. If exists but differs → generate upload URL, upload file, call rawFiles.reupload
   f. If not exists → generate upload URL, upload file, call rawFiles.create
3. Print summary: new uploads, re-uploads, skipped, errors
```

### Metadata Derived Locally

The script extracts minimal metadata without parsing the full JSONL:

- `sourceId`: from filename (session UUID)
- `fileName`: basename of the file
- `localFileSize`: from `fs.statSync`
- `localModifiedAt`: from `fs.statSync` (mtimeMs)
- `projectPath`: from directory structure (e.g., `~/.claude/projects/-Users-vinit-Tars-feynman/`)
- `projectName`: last segment of project path
- `sessionId`: from filename or directory name
- `timestamp`: file mtime (used as-is; not refined by extractors)

## Frontend

### Sidebar Navigation

Nested accordion structure:

```
📊 Dashboard
📚 Knowledge ▼
    Sources ▼                    ← collapsible accordion
      💬 Claude Transcripts (142)
      🔀 Git History (89)
    ───────────
    🔄 Pipeline (12)
🎬 Content ▶                    ← collapsible, sub-items TBD
⚙️ Settings
```

- Knowledge accordion: expanded by default, remembers state
- Sources sub-accordion: expanded by default, collapsible for when many sources exist
- Count badges show entry counts per source
- Active route highlighting on current page

### Routes

| Route | Page |
|-------|------|
| `/dashboard` | Overview dashboard (remove RecentEntries) |
| `/knowledge/sources/claude-transcripts` | Claude transcripts source detail |
| `/knowledge/sources/git-history` | Git history source detail (placeholder) |
| `/knowledge/pipeline` | Existing Kanban board (unchanged) |
| `/content` | Existing content pipeline (unchanged) |
| `/settings` | Existing cron config (unchanged) |

### Source Detail Page: Claude Transcripts

**Filter bar:**
- Extractor type dropdown (All / Project Work Summary / Engineering Decisions)
- Project dropdown (derived from rawFiles projectName values)
- Date range selector
- Search input (searches title and content)

**Entry list:**
- Chronological, newest first
- Each row shows: colored dot by extractor, title, project name, extractor tag, relative timestamp, message count
- Click row → slide-over panel opens

**Raw Files tab/section:**
- Toggle between "Extracted Entries" and "Raw Files" view
- Raw Files view shows: file name, project, upload date, file size, extraction status
- Status badges: uploaded / extracting / extracted / failed
- "Run Extractor" button per file for on-demand AI extraction

### Entry Slide-Over Panel

Right-side panel overlaying the list:

- **Header:** Title, timestamp, project tag, extractor tag
- **Content:** Full extracted text, markdown rendered
- **Metadata:** Message count, session ID, git branch, file size, raw file link
- **Actions:**
  - "Promote to Pipeline" → creates knowledge pipeline item at "ideas" stage, linked to this entry
  - "Run AI Extractor" → triggers engineering-decisions extractor on the source raw file (if not yet run)
  - "View Raw File" → opens/downloads the original JSONL

### Dashboard Changes

- Remove the `RecentEntries` component from the dashboard
- Keep `PipelineSnapshot` and `DigestCard`
- Dashboard remains the high-level overview

## File Changes Summary

### New Files

**Backend (`app/backend/convex/`):**
- `rawFiles.ts` — queries and mutations for raw file records (create, reupload, getBySourceId, list, updateStatus)
- `extraction.ts` — `runExtractor` internal action, mechanical parser registry, parser functions
- `extractors.ts` — extractor config queries, seed mutation
- `extractionPool.ts` — Workpool instance configuration

**Frontend (`app/frontend/src/`):**
- `app/(app)/knowledge/sources/claude-transcripts/page.tsx` — source detail page
- `app/(app)/knowledge/sources/git-history/page.tsx` — placeholder page
- `app/(app)/knowledge/sources/layout.tsx` — shared layout for source pages (if needed)
- `components/knowledge/entry-slide-over.tsx` — slide-over panel component
- `components/knowledge/source-entry-list.tsx` — filterable entry list component
- `components/knowledge/raw-files-list.tsx` — raw files browser component

### Modified Files

**Backend:**
- `schema.ts` — add `rawFiles`, `extractors` tables; add `rawFileId`, `extractorName` to `knowledgeEntries`
- `knowledgeEntries.ts` — add queries filtering by `rawFileId` and `extractorName`

**Backend (new):**
- `convex.config.ts` — new file; required to register the workpool component. Setting up a Convex component for the first time requires: installing the package, creating `convex.config.ts`, running `npx convex dev` to generate component bindings in `_generated/`

**Frontend:**
- `components/app-sidebar.tsx` — restructure to nested accordion navigation
- `app/(app)/dashboard/page.tsx` — remove RecentEntries component

**Scripts (`app/feynman-lib/scripts/`):**
- `ingest-claude-transcripts.ts` — rewrite to upload-only (no parsing)
- `shared/convex-client.ts` — add upload URL generation and raw file mutations

### Dependencies

- `@convex-dev/workpool` — Convex component for reliable background processing

## Implementation Phases

### Phase 1: Backend Data Model & Extraction Pipeline
- Add new tables to schema
- Install and configure `@convex-dev/workpool`
- Implement `rawFiles` mutations and queries
- Implement `extractors` table with seed data
- Implement `runExtractor` action with `claude-strip-tools` mechanical parser
- Write onComplete handlers and status tracking

### Phase 2: Upload Script & Ingestion
- Rewrite `ingest-claude-transcripts.ts` to upload-only
- Implement change detection (file size + mtime)
- Add upload URL generation mutation
- Test end-to-end: upload → auto-extract → knowledge entries created

### Phase 3: Frontend Navigation & Source Pages
- Restructure sidebar with nested accordions
- Remove RecentEntries from dashboard
- Build Claude Transcripts source detail page (filterable list)
- Build entry slide-over panel
- Build raw files browser
- Add "Promote to Pipeline" action
- Add on-demand AI extractor trigger

### Phase 4: AI Extraction (Engineering Decisions)
- Design and test the Claude API prompt template
- Implement AI extraction path in `runExtractor`
- Add frontend trigger for on-demand AI extraction
- Test with real transcripts
