# AI Topic Segmentation & Summarization Pipeline Design

**Date:** 2026-03-17
**Status:** Approved
**Scope:** Add an AI-powered multi-pass pipeline that segments Claude Code transcript sessions into topics, summarizes each topic, classifies its development stage, and provides a unified topic-based view in the frontend.

---

## Problem

The current "project-work-summary" mechanical extractor shows a flat list of all human/assistant messages in a session. For sessions where multiple features, bug fixes, or refactors are discussed, there's no way to:

1. See what distinct topics were worked on in a session at a glance
2. Get a summary of what happened for each topic without reading every message
3. Know the development stage of each topic (brainstorming, design, implemented, etc.)
4. Navigate directly to a specific topic's conversation within a long session

## Solution

A three-pass AI pipeline that runs on-demand per session:

1. **Pass 1 — Topic Boundary Detection:** Identify where one topic ends and another begins, with preliminary names
2. **Pass 2 — Per-topic Summarization:** For each segment, generate a refined name, one-sentence title, paragraph summary, and stage classification
3. **Pass 3 — Session Title Synthesis:** Generate an overall session title from all topic summaries

Results are stored in a new `topicSegmentation` field on the existing knowledgeEntry, alongside the mechanical `content` (which is preserved unchanged). A new `TopicSegmentationRenderer` displays the topics as collapsible accordions with summaries and embedded conversation messages.

---

## AI Pipeline Architecture

### Overview

The pipeline needs the full `ConversationMessage[]` array for the session. The mechanical parser's `content` field may be truncated for large sessions (capped at 50K chars, dropping trailing messages). Therefore:

**To ensure the AI pipeline always operates on the complete conversation, the 50K character truncation in `parseClaudeStripTools` should be removed.** The real constraint is Convex's 1MB document size limit, and conversations rarely exceed ~200KB of serialized JSON. This also fixes a subtle issue: `topicSegmentation.messageRange` indexes must match the `ConversationMessage[]` array in `content` — if `content` were truncated, indexes from the AI pipeline (which needs the full conversation) would be out of bounds for the renderer.

**Implementation:** Add an optional `maxContentLength` parameter to `parseClaudeStripTools` (defaulting to `undefined` = no limit). Remove the hardcoded 50K cap. As a safety net, if the serialized JSON exceeds 900KB (leaving room for other fields within the 1MB document limit), truncate at message boundaries and log a warning.

```
ConversationMessage[] (from content field — now untruncated)
        │
        ▼
   Pass 1: Topic Boundary Detection
   (chunked if > 80K tokens)
        │
        ▼
   Array<{ name, messageRange }>
        │
        ▼
   Pass 2: Per-topic Summarization
   (one API call per topic)
        │
        ▼
   Array<{ name, title, stage, summary, messageRange }>
        │
        ▼
   Pass 3: Session Title Synthesis
   (single API call, tiny input)
        │
        ▼
   TopicSegmentation object → stored on knowledgeEntry
```

### Token Management

LLMs produce best results within ~100K tokens of context. The pipeline uses token-based chunking (not message-count-based) since message sizes vary widely.

**Token estimation:** `Math.ceil(text.length / 4)` — rough but sufficient for chunking decisions.

**Thresholds:**
- **Single-call limit:** 80K tokens (leaves room for prompt instructions + response)
- **Chunk target:** 60K tokens per chunk
- **Chunk overlap:** 20K tokens (~10-15 messages repeated between chunks)

**For most sessions (< 80K tokens):** The entire conversation goes in a single Pass 1 call. No chunking needed. This is the common path — typical sessions have 30-80 messages.

**For large sessions (>= 80K tokens):** Split into overlapping chunks:
1. Walk through messages accumulating token count
2. When a chunk reaches ~60K tokens, mark the chunk boundary
3. The next chunk starts ~20K tokens back (overlap region)
4. Each chunk gets its own Pass 1 API call
5. Merge boundary results: boundaries detected in overlap regions by both chunks are high-confidence; boundaries from only one chunk are still included
6. Deduplicate by proximity: if two boundaries are within 2 messages of each other, keep the one from the chunk where it's more central

### Pass 1: Topic Boundary Detection

**Input:** The full `ConversationMessage[]` array (or a chunk of it), serialized as a simplified text representation for the prompt. Each message is formatted as:

```
[MSG {index}] {role} ({timestamp})
{text (first 500 chars if long)}
---
```

Tool calls are omitted from the boundary detection input — they add noise without helping identify topic shifts. The 500-char truncation keeps token count manageable while preserving enough context for boundary detection.

**Prompt structure:**

```
You are analyzing a Claude Code conversation transcript to identify distinct topic boundaries.

A "topic" is a coherent unit of work — a feature being developed, a bug being fixed, a refactor,
a brainstorming session, a design discussion, etc. Topics change when the user shifts to working
on something meaningfully different.

DO NOT split a topic just because the conversation has back-and-forth — a long discussion about
the same feature is ONE topic. Only split when the actual subject of work changes.

Here is the conversation (message indices in brackets):

{formatted messages}

Return a JSON array of topic segments. Each segment has:
- name: Short descriptive name (2-5 words)
- startIndex: Index of first message in this topic
- endIndex: Index of last message in this topic (inclusive)

Every message must belong to exactly one topic. Topics must be contiguous and non-overlapping.
The first topic starts at index 0 and the last topic ends at the last message index.

Respond with ONLY the JSON array, no other text.
```

**Output:** `Array<{ name: string, startIndex: number, endIndex: number }>`

**Chunked merge logic:** When multiple chunks produce boundary arrays:
1. Convert each chunk's local indices to global message indices
2. Concatenate all boundary arrays
3. For the overlap region: if both chunks agree on a boundary (within ±2 messages), keep it; if only one chunk reports a boundary in the overlap, keep it but mark as lower confidence
4. Rebuild the contiguous boundary array ensuring full coverage (no gaps, no overlaps)

**Boundary validation (always runs, chunked or not):**
After Pass 1 produces the boundary array, validate and repair:
1. Sort topics by `startIndex`
2. If `topics[0].startIndex !== 0`, set it to 0
3. If `topics[last].endIndex !== totalMessages - 1`, set it to `totalMessages - 1`
4. Check for gaps: if `topics[i].endIndex + 1 !== topics[i+1].startIndex`, extend the earlier topic's `endIndex` to fill the gap
5. Check for overlaps: if `topics[i].endIndex >= topics[i+1].startIndex`, set `topics[i].endIndex = topics[i+1].startIndex - 1`
This ensures every message belongs to exactly one topic, even if Claude's output has minor off-by-one errors.

### Pass 2: Per-topic Summarization

**Input per topic:** The actual `ConversationMessage[]` slice for that topic's message range, formatted with full message text (not truncated).

**Prompt structure:**

```
You are analyzing a segment of a Claude Code conversation about a specific topic.

Topic name (preliminary): {name from Pass 1}

Here is the conversation segment:

{full messages for this topic}

Analyze this conversation and provide:

1. name: A refined short name for this topic (2-5 words)
2. title: A one-sentence title describing what was accomplished or discussed
3. stage: The development stage this topic reached. Must be one of:
   - "brainstorming" — Exploring ideas, discussing approaches, no concrete artifacts yet
   - "design" — A design document, spec, or architecture has been created or discussed
   - "planning" — A detailed implementation plan has been created
   - "implemented" — Code has been written and the feature/fix is functional
   - "verified" — Implementation has been verified, tested, or merged to main
4. summary: A paragraph (3-5 sentences) summarizing what happened in this topic

Respond with ONLY a JSON object with these four fields, no other text.
```

**Output:** `{ name: string, title: string, stage: string, summary: string }`

### Pass 3: Session Title Synthesis

**Input:** All topic titles and summaries concatenated (very small — typically a few hundred tokens).

**Prompt structure:**

```
Here are the topics discussed in a Claude Code session:

{for each topic: "Topic {id}: {title}\n{summary}\n\n"}

Generate a single concise title (under 80 characters) for this entire session that captures
the main work done. If there was one dominant topic, focus on that. If multiple equally
important topics, mention the key ones.

Respond with ONLY the title text, no quotes, no other text.
```

**Output:** A plain string — the session title.

### API Configuration

- **Model:** Claude Sonnet 4 (`claude-sonnet-4-20250514`) — good balance of quality and speed for this task
- **Max tokens per call:**
  - Pass 1: 4096 (boundary detection output is compact)
  - Pass 2: 2048 (summary output is compact)
  - Pass 3: 256 (just a title)
- **Temperature:** 0 (deterministic, reproducible results)

### Pass 2: Large Topic Handling

If a single topic's messages exceed ~80K tokens (rare but possible for long debugging sessions), the Pass 2 prompt would exceed model context. In this case, truncate assistant messages to the first 1000 characters each for the summarization prompt. Human messages are kept in full (they're typically short). This preserves enough context for a good summary while fitting within limits.

### Error Handling

The pipeline uses an **all-or-nothing** approach for v1:

- **JSON parsing failures:** Each Claude API response is parsed with try/catch. If parsing fails, retry the specific API call once with a slightly modified prompt (adding "Remember: respond with ONLY valid JSON"). If it fails again, the entire pipeline fails.
- **Partial failures in Pass 2:** If any topic's summarization call fails after retries, the entire pipeline fails. No partial results are stored.
- **Rate limiting:** The workpool's built-in retry logic (3 attempts with exponential backoff) handles transient API errors. If all retries are exhausted, the pipeline fails and the extractionResult status is set to "failed" with an error message.
- **Full pipeline retries:** When the workpool retries the action, it restarts from scratch (re-running all API calls). This is acceptable for v1 — the pipeline is idempotent.

---

## Data Model

### Schema Change

Add one field to the `knowledgeEntries` table in `schema.ts`:

```typescript
topicSegmentation: v.optional(v.any()),
```

### TopicSegmentation Structure

Stored as a native Convex object (not a stringified JSON string) in the `topicSegmentation` field:

```typescript
interface TopicSegmentation {
  sessionTitle: string;                // Pass 3 output
  extractionModel: string;             // "claude-sonnet-4-20250514"
  extractedAt: number;                 // Date.now() when pipeline completed
  pipelineVersion: string;             // "1.0"
  topics: TopicSegment[];
}

interface TopicSegment {
  id: number;                          // 1-indexed
  name: string;                        // Short name: "JWT Auth Middleware"
  title: string;                       // One-sentence: "Implement JWT auth middleware with refresh tokens"
  stage: "brainstorming" | "design" | "planning" | "implemented" | "verified";
  summary: string;                     // Paragraph-level summary
  messageRange: {
    start: number;                     // Index into ConversationMessage[] in content
    end: number;                       // Inclusive end index
  };
}
```

### Relationship to Existing Fields

The `topicSegmentation` field lives on the **same knowledgeEntry** as the mechanical extraction:

```
knowledgeEntry (extractorName = "project-work-summary"):
  content:             ConversationMessage[] (JSON string, unchanged)
  topicSegmentation:   TopicSegmentation object (NEW, populated by AI pipeline)
  title:               string (unchanged — derived by mechanical parser)
  metadata:            { messageCount, parser, format, ... } (unchanged)
```

The `content` field is **never modified** by the AI pipeline. `topicSegmentation` is an independent enrichment layer.

### Session Title Side Effect

When Pass 3 produces a session title and the rawFile does NOT have a user-set `displayName`, the pipeline updates `rawFile.displayName` with the AI-generated session title. This makes session titles in the list much more meaningful after AI extraction.

If the user has already manually renamed the session (set `displayName`), the AI title is stored only in `topicSegmentation.sessionTitle` and does not override the user's name.

---

## Backend Changes

### New internalAction: `runTopicSegmentation`

**File:** `app/backend/convex/extraction.ts`

A new internalAction that implements the 3-pass pipeline. Note: `extraction.ts` already has `"use node"` at the top (required for Convex actions that use Node.js APIs like the Anthropic SDK), so no additional directive is needed.

```typescript
export const runTopicSegmentation = internalAction({
  args: {
    rawFileId: v.id("rawFiles"),
  },
  returns: v.object({ entryCount: v.number() }),
  handler: async (ctx, { rawFileId }) => {
    // 1. Fetch rawFile
    // 2. Fetch the project-work-summary knowledgeEntry, parse content into ConversationMessage[]
    // 3. Run Pass 1: topic boundary detection (chunked if > 80K tokens)
    // 4. Run Pass 2: per-topic summarization (one API call per topic)
    //    - If a single topic's messages exceed 80K tokens, truncate assistant messages
    //      to first 1000 chars each for the summarization prompt
    // 5. Run Pass 3: session title synthesis
    // 6. Call patchTopicSegmentation with extractorName: "project-work-summary"
    // 7. If rawFile.displayName is not set, call setDisplayName to update it
    // Return { entryCount: topics.length }
  },
});
```

**Prompt templates** are defined as constants within `extraction.ts` (not in the extractors table) since the multi-pass pipeline doesn't fit the single-template extractor model.

### Helper Functions

Also in `extraction.ts`:

- `estimateTokens(text: string): number` — returns `Math.ceil(text.length / 4)`
- `formatMessagesForBoundaryDetection(messages: ConversationMessage[]): string` — formats messages with indices, truncated text, no tool calls
- `formatMessagesForSummarization(messages: ConversationMessage[]): string` — formats messages with full text for summarization
- `chunkMessages(messages: ConversationMessage[], maxTokens: number, overlapTokens: number): Array<{ messages: ConversationMessage[], globalStartIndex: number }>` — splits into overlapping token-based chunks
- `mergeBoundaries(chunkResults: Array<Array<{ name, startIndex, endIndex }>>, totalMessageCount: number): Array<{ name, startIndex, endIndex }>` — deduplicates and rebuilds contiguous boundaries

### New internalMutation: `patchTopicSegmentation`

**File:** `app/backend/convex/knowledgeEntries.ts`

```typescript
export const patchTopicSegmentation = internalMutation({
  args: {
    rawFileId: v.id("rawFiles"),
    extractorName: v.string(),
    topicSegmentation: v.any(),
  },
  handler: async (ctx, args) => {
    const entry = await ctx.db
      .query("knowledgeEntries")
      .withIndex("by_rawFile_extractor", (q) =>
        q.eq("rawFileId", args.rawFileId).eq("extractorName", args.extractorName)
      )
      .unique();
    if (!entry) throw new Error("Knowledge entry not found");
    await ctx.db.patch(entry._id, { topicSegmentation: args.topicSegmentation });
  },
});
```

### New internalMutation: `setDisplayName`

**File:** `app/backend/convex/rawFiles.ts`

Needed because `runTopicSegmentation` is an `internalAction` — it can only call `internalMutation` via `ctx.runMutation`, not public mutations. The existing `renameSession` is a public `mutation` and cannot be called from an action context.

```typescript
export const setDisplayName = internalMutation({
  args: {
    rawFileId: v.id("rawFiles"),
    displayName: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const rawFile = await ctx.db.get(args.rawFileId);
    if (!rawFile) return null;
    // Only set if user hasn't manually named it
    if (!rawFile.displayName) {
      await ctx.db.patch(args.rawFileId, { displayName: args.displayName });
    }
    return null;
  },
});
```

### New Mutation: `triggerTopicSegmentation`

**File:** `app/backend/convex/rawFiles.ts`

```typescript
export const triggerTopicSegmentation = mutation({
  args: {
    rawFileId: v.id("rawFiles"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const rawFile = await ctx.db.get(args.rawFileId);
    if (!rawFile) throw new Error("Raw file not found");

    // Guard against concurrent runs
    const existing = (rawFile.extractionResults ?? []).find(
      (r) => r.extractorName === "topic-segmentation"
    );
    if (existing && (existing.status === "pending" || existing.status === "running")) {
      return null; // Already in progress
    }

    // Add/reset "topic-segmentation" in extractionResults
    const results = [...(rawFile.extractionResults ?? [])];
    const idx = results.findIndex((r) => r.extractorName === "topic-segmentation");
    const entry = { extractorName: "topic-segmentation", status: "pending" as const, entryCount: 0 };
    if (idx === -1) results.push(entry);
    else results[idx] = entry;

    await ctx.db.patch(args.rawFileId, {
      status: "extracting",
      extractionResults: results,
    });

    // Enqueue the AI pipeline
    await extractionPool.enqueueAction(
      ctx,
      internal.extraction.runTopicSegmentation,
      { rawFileId: args.rawFileId },
      {
        onComplete: internal.extractionPool.handleExtractionComplete,
        context: { rawFileId: args.rawFileId, extractorName: "topic-segmentation" },
      }
    );

    return null;
  },
});
```

This reuses the existing `extractionPool` and `handleExtractionComplete` callback, which already knows how to update `extractionResults` status and transition the rawFile's overall status.

---

## Frontend Changes

### Slide-over Header: "Analyze Topics" Button

**File:** `app/frontend/src/components/knowledge/session-slide-over.tsx`

Add below the View dropdown:

- **Button states:**
  - Default: `✨ Analyze Topics` — calls `api.rawFiles.triggerTopicSegmentation`
  - Running: `⏳ Analyzing...` — disabled, shown when `extractionResults` has `topic-segmentation` with status `pending` or `running`
  - Complete: Button stays available for re-analysis; view dropdown now includes "Topic Summary"
  - Failed: `⚠️ Analysis Failed` — shows error, button re-enabled for retry

- **Status detection:** The slide-over currently receives `rawFile` as a prop (a snapshot). To show live extraction progress, add a `useQuery(api.rawFiles.getBySourceId, ...)` call inside the slide-over that subscribes to the rawFile document. This gives real-time status updates via Convex's reactive queries. Check `extractionResults.find(r => r.extractorName === "topic-segmentation")?.status` on the live data. Note: a `getById` public query may need to be added to `rawFiles.ts` (currently only `getById` is an `internalQuery`).

### View Dropdown: "Topic Summary" Option

The View dropdown currently lists all extractors from `api.extractors.list` + "Raw Transcript". Add a new dynamic option:

- **"Topic Summary"** — only shown when the knowledgeEntry for `project-work-summary` has `topicSegmentation` populated (non-null)
- When selected, the slide-over renders `TopicSegmentationRenderer` instead of `ConversationRenderer`
- **Becomes the default view** when available. The existing `useEffect` that sets `selectedView` to the first extractor (around line 89-93 of `session-slide-over.tsx`) should be updated: if the `project-work-summary` entry has `topicSegmentation` populated, default to `"topic-summary"` instead of the first extractor name

### TopicSegmentationRenderer Component

**File:** `app/frontend/src/components/knowledge/renderers/topic-segmentation-renderer.tsx`

**Props:**

```typescript
interface TopicSegmentationRendererProps {
  topicSegmentation: TopicSegmentation;
  conversationMessages: ConversationMessage[];
}
```

**Layout:**

1. **Session header:**
   - Session title (large, from `topicSegmentation.sessionTitle`)
   - Topic count + "Analyzed {timeAgo}" metadata line

2. **Topic accordions:** One per topic, each containing:
   - **Header (always visible):** Chevron, topic number + name, stage badge (color-coded), message count
   - **Summary (always visible when expanded):** The paragraph summary
   - **Conversation (collapsible within the topic):** The actual `ConversationMessage` objects for `messageRange.start` to `messageRange.end`, rendered using the existing `MessageBubble` component from `conversation-renderer.tsx`

3. **Collapse/Expand All** toggle at the top (same pattern as ConversationRenderer)

**Stage badge colors:**

| Stage | Color | Label |
|-------|-------|-------|
| brainstorming | Purple (`purple-100`/`purple-800`) | Brainstorming |
| design | Blue (`blue-100`/`blue-800`) | Design/Spec |
| planning | Yellow (`yellow-100`/`yellow-800`) | Planning |
| implemented | Green (`green-100`/`green-800`) | Implemented |
| verified | Teal (`teal-100`/`teal-800`) | Verified |

### Shared Components

**File:** `app/frontend/src/components/knowledge/renderers/conversation-renderer.tsx`

Add the `export` keyword to `MessageBubble` and `ToolCallChips` function declarations (currently plain `function`, not exported) so the topic segmentation renderer can import and reuse them.

---

## Files Changed

| File | Change |
|------|--------|
| `app/backend/convex/schema.ts` | Add `topicSegmentation: v.optional(v.any())` to knowledgeEntries |
| `app/backend/convex/extraction.ts` | Remove 50K truncation cap from `parseClaudeStripTools` (use 900KB safety limit instead); add `runTopicSegmentation` internalAction + helper functions for chunking, formatting, boundary validation, merging |
| `app/backend/convex/rawFiles.ts` | Add `triggerTopicSegmentation` mutation (with concurrent-run guard) + `setDisplayName` internalMutation + `getByIdPublic` query (for live status in slide-over) |
| `app/backend/convex/knowledgeEntries.ts` | Add `patchTopicSegmentation` internalMutation |
| `app/frontend/src/components/knowledge/session-slide-over.tsx` | Add "Analyze Topics" button, status tracking, "Topic Summary" view option |
| `app/frontend/src/components/knowledge/renderers/topic-segmentation-renderer.tsx` | **New:** Accordion-based topic view with summaries + embedded messages |
| `app/frontend/src/components/knowledge/renderers/conversation-renderer.tsx` | Export `MessageBubble` and `ToolCallChips` |

## What Stays the Same

- Mechanical extractor pipeline (unchanged)
- `content` field on knowledgeEntries (unchanged — AI pipeline reads it, never writes it)
- ConversationRenderer behavior (unchanged, just exports sub-components)
- Ingestion pipeline (unchanged)
- Session list component (unchanged, benefits from better displayName after AI extraction)
- Raw Transcript view (unchanged)
- Existing "Project Work Summary" view (unchanged)

## Future Extensions

- **Batch analysis:** "Analyze All" button on project accordion to run AI extraction on all sessions in a project
- **Auto-run:** Optionally trigger AI extraction automatically after mechanical extraction completes
- **Cross-session topics:** Link topics across sessions that are about the same feature
- **Git worktree awareness:** Detect worktree naming patterns (project--A, project--Trinity, etc.) and group sessions accordingly
- **Topic editing:** Let users manually adjust topic boundaries, rename topics, or change stage classifications
