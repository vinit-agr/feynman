# AI Topic Segmentation & Summarization Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an AI-powered multi-pass pipeline that segments Claude Code transcript sessions into topics, summarizes each, classifies development stages, and displays results in a topic-based accordion view.

**Architecture:** Three-pass AI pipeline (boundary detection → per-topic summarization → session title) enriches the existing mechanical extraction's knowledgeEntry with a `topicSegmentation` field. Token-based chunking handles arbitrarily long conversations. A new `TopicSegmentationRenderer` displays the results. Triggered on-demand via a button in the slide-over.

**Tech Stack:** Convex (schema, mutations, actions), Anthropic Claude API, Next.js App Router, React, Tailwind CSS, TypeScript

**Spec:** `docs/superpowers/specs/2026-03-17-topic-segmentation-design.md`

---

## Chunk 1: Backend — Schema, Mutations, Truncation Fix

### Task 1: Schema Changes

**Files:**
- Modify: `app/backend/convex/schema.ts`

- [ ] **Step 1: Add `topicSegmentation` field to knowledgeEntries table**

In `app/backend/convex/schema.ts`, add after the `extractorName` field in the `knowledgeEntries` table:

```typescript
    topicSegmentation: v.optional(v.any()),  // AI-generated topic analysis
```

- [ ] **Step 2: Commit**

```bash
git add app/backend/convex/schema.ts
git commit -m "feat: add topicSegmentation field to knowledgeEntries schema"
```

### Task 2: Remove 50K Truncation Cap from Parser

**Files:**
- Modify: `app/backend/convex/extraction.ts`

- [ ] **Step 1: Replace the 50K truncation with a 900KB safety limit**

Find the truncation block in `parseClaudeStripTools` (search for `50_000`):

```typescript
  // Serialize to JSON, truncating at message boundaries if over 50K
  let content: string;
  let truncatedMessages = messages;
  content = JSON.stringify(truncatedMessages);
  while (content.length > 50_000 && truncatedMessages.length > 1) {
    truncatedMessages = truncatedMessages.slice(0, -1);
    content = JSON.stringify(truncatedMessages);
  }
```

Replace with:

```typescript
  // Serialize to JSON, truncating at message boundaries if over 900KB
  // (Convex documents have a 1MB limit; 900KB leaves room for other fields)
  const MAX_CONTENT_BYTES = 900_000;
  let content: string;
  let truncatedMessages = messages;
  content = JSON.stringify(truncatedMessages);
  while (content.length > MAX_CONTENT_BYTES && truncatedMessages.length > 1) {
    truncatedMessages = truncatedMessages.slice(0, -1);
    content = JSON.stringify(truncatedMessages);
  }
```

Also update the `messageCount` in metadata (already uses `truncatedMessages.length`, so no change needed there).

- [ ] **Step 2: Verify build**

Run: `cd /Users/vinit/Tars/Content-Creation/feynman && pnpm build`

- [ ] **Step 3: Commit**

```bash
git add app/backend/convex/extraction.ts
git commit -m "feat: raise content truncation cap from 50K to 900KB for full conversation support"
```

### Task 3: Backend Mutations for Topic Segmentation

**Files:**
- Modify: `app/backend/convex/knowledgeEntries.ts`
- Modify: `app/backend/convex/rawFiles.ts`

- [ ] **Step 1: Add `patchTopicSegmentation` to knowledgeEntries.ts**

At the end of `app/backend/convex/knowledgeEntries.ts`, add:

```typescript
export const patchTopicSegmentation = internalMutation({
  args: {
    rawFileId: v.id("rawFiles"),
    extractorName: v.string(),
    topicSegmentation: v.any(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const entry = await ctx.db
      .query("knowledgeEntries")
      .withIndex("by_rawFile_extractor", (q) =>
        q.eq("rawFileId", args.rawFileId).eq("extractorName", args.extractorName)
      )
      .unique();
    if (!entry) throw new Error("Knowledge entry not found for topic segmentation");
    await ctx.db.patch(entry._id, { topicSegmentation: args.topicSegmentation });
    return null;
  },
});
```

Note: `internalMutation` is already imported at the top of the file.

- [ ] **Step 2: Add `setDisplayName` and `getByIdPublic` to rawFiles.ts**

At the end of `app/backend/convex/rawFiles.ts`, add:

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

export const getByIdPublic = query({
  args: {
    id: v.id("rawFiles"),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});
```

- [ ] **Step 3: Add `triggerTopicSegmentation` to rawFiles.ts**

Add to `app/backend/convex/rawFiles.ts` (requires importing `internal` and `extractionPool` — both are already imported):

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
      return null;
    }

    // Add/reset "topic-segmentation" in extractionResults
    const results = [...(rawFile.extractionResults ?? [])];
    const idx = results.findIndex((r) => r.extractorName === "topic-segmentation");
    const entry = {
      extractorName: "topic-segmentation",
      status: "pending" as const,
      entryCount: 0,
    };
    if (idx === -1) results.push(entry);
    else results[idx] = entry;

    await ctx.db.patch(args.rawFileId, {
      status: "extracting",
      extractionResults: results,
    });

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

- [ ] **Step 4: Verify build**

Run: `cd /Users/vinit/Tars/Content-Creation/feynman && pnpm build`

Note: The build will show an error that `internal.extraction.runTopicSegmentation` doesn't exist yet. This is expected — it will be created in Task 4. You can temporarily comment out the `enqueueAction` call to verify the rest compiles, or proceed directly to Task 4.

- [ ] **Step 5: Commit**

```bash
git add app/backend/convex/knowledgeEntries.ts app/backend/convex/rawFiles.ts
git commit -m "feat: add triggerTopicSegmentation, patchTopicSegmentation, setDisplayName, getByIdPublic"
```

---

## Chunk 2: Backend — AI Pipeline Implementation

### Task 4: Implement `runTopicSegmentation` Action

**Files:**
- Modify: `app/backend/convex/extraction.ts`

This is the largest task. It adds the 3-pass AI pipeline as an `internalAction`, plus all helper functions.

- [ ] **Step 1: Add helper functions before the PARSERS registry**

Find the `const PARSERS` line in `extraction.ts`. Add these helper functions before it:

```typescript
// ---------------------------------------------------------------------------
// Topic Segmentation Helpers
// ---------------------------------------------------------------------------

const SINGLE_CALL_TOKEN_LIMIT = 80_000;
const CHUNK_TARGET_TOKENS = 60_000;
const CHUNK_OVERLAP_TOKENS = 20_000;
const LARGE_TOPIC_TOKEN_LIMIT = 80_000;

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function formatMessagesForBoundaryDetection(
  messages: ConversationMessage[],
  globalStartIndex: number = 0
): string {
  return messages
    .map((m, i) => {
      const idx = globalStartIndex + i;
      const role = m.role === "human" ? "Human" : "Assistant";
      const ts = m.timestamp ? ` (${m.timestamp})` : "";
      const text =
        m.text.length > 500 ? m.text.slice(0, 497) + "..." : m.text;
      return `[MSG ${idx}] ${role}${ts}\n${text}\n---`;
    })
    .join("\n");
}

function formatMessagesForSummarization(
  messages: ConversationMessage[],
  truncateAssistant: boolean = false
): string {
  return messages
    .map((m) => {
      const role = m.role === "human" ? "Human" : "Assistant";
      let text = m.text;
      if (truncateAssistant && m.role === "assistant" && text.length > 1000) {
        text = text.slice(0, 997) + "...";
      }
      const toolInfo =
        m.toolCalls && m.toolCalls.length > 0
          ? `\n[Tools used: ${m.toolCalls.map((t) => t.tool).join(", ")}]`
          : "";
      return `### ${role}\n\n${text}${toolInfo}`;
    })
    .join("\n\n---\n\n");
}

interface ChunkInfo {
  messages: ConversationMessage[];
  globalStartIndex: number;
}

function chunkMessages(
  messages: ConversationMessage[],
  maxTokens: number,
  overlapTokens: number
): ChunkInfo[] {
  const totalTokens = messages.reduce(
    (sum, m) => sum + estimateTokens(m.text),
    0
  );

  // If fits in a single call, no chunking needed
  if (totalTokens <= maxTokens) {
    return [{ messages, globalStartIndex: 0 }];
  }

  const chunks: ChunkInfo[] = [];
  let startIdx = 0;

  while (startIdx < messages.length) {
    let tokenCount = 0;
    let endIdx = startIdx;

    // Accumulate messages until we hit the chunk target
    while (endIdx < messages.length && tokenCount < maxTokens) {
      tokenCount += estimateTokens(messages[endIdx].text);
      endIdx++;
    }

    chunks.push({
      messages: messages.slice(startIdx, endIdx),
      globalStartIndex: startIdx,
    });

    if (endIdx >= messages.length) break;

    // Calculate overlap: go back by overlapTokens worth of messages
    let overlapCount = 0;
    let overlapIdx = endIdx;
    while (overlapIdx > startIdx && overlapCount < overlapTokens) {
      overlapIdx--;
      overlapCount += estimateTokens(messages[overlapIdx].text);
    }
    startIdx = overlapIdx;
  }

  return chunks;
}

interface RawBoundary {
  name: string;
  startIndex: number;
  endIndex: number;
}

function validateAndRepairBoundaries(
  boundaries: RawBoundary[],
  totalMessages: number
): RawBoundary[] {
  if (boundaries.length === 0) {
    return [{ name: "Full Session", startIndex: 0, endIndex: totalMessages - 1 }];
  }

  // Sort by startIndex
  boundaries.sort((a, b) => a.startIndex - b.startIndex);

  // Fix first topic start
  boundaries[0].startIndex = 0;

  // Fix last topic end
  boundaries[boundaries.length - 1].endIndex = totalMessages - 1;

  // Fix gaps and overlaps
  for (let i = 0; i < boundaries.length - 1; i++) {
    const current = boundaries[i];
    const next = boundaries[i + 1];

    if (current.endIndex + 1 < next.startIndex) {
      // Gap — extend current to fill
      current.endIndex = next.startIndex - 1;
    } else if (current.endIndex >= next.startIndex) {
      // Overlap — trim current
      current.endIndex = next.startIndex - 1;
    }
  }

  // Remove any degenerate topics (start > end after repairs)
  return boundaries.filter((b) => b.startIndex <= b.endIndex);
}

function mergeBoundaries(
  chunkResults: Array<{ boundaries: RawBoundary[]; globalStartIndex: number }>,
  totalMessages: number
): RawBoundary[] {
  if (chunkResults.length === 1) {
    return validateAndRepairBoundaries(chunkResults[0].boundaries, totalMessages);
  }

  // Convert local indices to global
  const allBoundaries: RawBoundary[] = [];
  for (const chunk of chunkResults) {
    for (const b of chunk.boundaries) {
      allBoundaries.push({
        name: b.name,
        startIndex: b.startIndex + chunk.globalStartIndex,
        endIndex: b.endIndex + chunk.globalStartIndex,
      });
    }
  }

  // Sort and deduplicate boundaries that are within 2 messages of each other
  allBoundaries.sort((a, b) => a.startIndex - b.startIndex);
  const deduped: RawBoundary[] = [];
  for (const b of allBoundaries) {
    const prev = deduped[deduped.length - 1];
    if (prev && Math.abs(prev.startIndex - b.startIndex) <= 2) {
      // Merge: keep the one with the later endIndex (more complete)
      if (b.endIndex > prev.endIndex) {
        prev.endIndex = b.endIndex;
        prev.name = b.name;
      }
    } else {
      deduped.push({ ...b });
    }
  }

  return validateAndRepairBoundaries(deduped, totalMessages);
}

async function callClaudeJSON<T>(
  anthropic: InstanceType<typeof import("@anthropic-ai/sdk").default>,
  prompt: string,
  maxTokens: number
): Promise<T> {
  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: maxTokens,
    temperature: 0,
    messages: [{ role: "user", content: prompt }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("No text response from Claude API");
  }

  try {
    return JSON.parse(textBlock.text) as T;
  } catch {
    // Retry with stricter prompt
    const retryResponse = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: maxTokens,
      temperature: 0,
      messages: [
        { role: "user", content: prompt + "\n\nRemember: respond with ONLY valid JSON, no other text." },
      ],
    });
    const retryBlock = retryResponse.content.find((b) => b.type === "text");
    if (!retryBlock || retryBlock.type !== "text") {
      throw new Error("No text response from Claude API on retry");
    }
    // Try to extract JSON from response (handle markdown code blocks)
    const text = retryBlock.text.trim();
    const jsonMatch = text.match(/\[[\s\S]*\]/) || text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]) as T;
    }
    return JSON.parse(text) as T;
  }
}
```

- [ ] **Step 2: Add prompt template constants**

Add after the helpers, still before `const PARSERS`:

```typescript
// ---------------------------------------------------------------------------
// Topic Segmentation Prompt Templates
// ---------------------------------------------------------------------------

const BOUNDARY_DETECTION_PROMPT = `You are analyzing a Claude Code conversation transcript to identify distinct topic boundaries.

A "topic" is a coherent unit of work — a feature being developed, a bug being fixed, a refactor, a brainstorming session, a design discussion, etc. Topics change when the user shifts to working on something meaningfully different.

DO NOT split a topic just because the conversation has back-and-forth — a long discussion about the same feature is ONE topic. Only split when the actual subject of work changes.

Here is the conversation (message indices in brackets):

{{content}}

Return a JSON array of topic segments. Each segment has:
- name: Short descriptive name (2-5 words)
- startIndex: Index of first message in this topic
- endIndex: Index of last message in this topic (inclusive)

Every message must belong to exactly one topic. Topics must be contiguous and non-overlapping.
The first topic starts at index 0 and the last topic ends at the last message index.

Respond with ONLY the JSON array, no other text.`;

const TOPIC_SUMMARY_PROMPT = `You are analyzing a segment of a Claude Code conversation about a specific topic.

Topic name (preliminary): {{topicName}}

Here is the conversation segment:

{{content}}

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

Respond with ONLY a JSON object with these four fields, no other text.`;

const SESSION_TITLE_PROMPT = `Here are the topics discussed in a Claude Code session:

{{content}}

Generate a single concise title (under 80 characters) for this entire session that captures the main work done. If there was one dominant topic, focus on that. If multiple equally important topics, mention the key ones.

Respond with ONLY the title text, no quotes, no other text.`;
```

- [ ] **Step 3: Add the `runTopicSegmentation` internalAction**

Add after the `runExtractor` internalAction (at the end of the file):

```typescript
// ---------------------------------------------------------------------------
// runTopicSegmentation internalAction
// ---------------------------------------------------------------------------

export const runTopicSegmentation = internalAction({
  args: {
    rawFileId: v.id("rawFiles"),
  },
  returns: v.object({ entryCount: v.number() }),
  handler: async (ctx, { rawFileId }) => {
    // 1. Fetch rawFile
    const rawFile = await ctx.runQuery(internal.rawFiles.getById, { id: rawFileId });
    if (!rawFile) throw new Error(`rawFile not found: ${rawFileId}`);

    // 2. Fetch the project-work-summary knowledgeEntry
    const entries = await ctx.runQuery(internal.knowledgeEntries.getByRawFileAndExtractor, {
      rawFileId,
      extractorName: "project-work-summary",
    });
    if (!entries) {
      throw new Error("No project-work-summary entry found. Run mechanical extraction first.");
    }

    // 3. Parse content into ConversationMessage[]
    let messages: ConversationMessage[];
    try {
      messages = JSON.parse(entries.content) as ConversationMessage[];
    } catch {
      throw new Error("Failed to parse conversation messages from content field");
    }

    if (messages.length === 0) {
      throw new Error("No messages found in conversation");
    }

    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    const anthropic = new Anthropic();

    // 4. Pass 1: Topic Boundary Detection
    const chunks = chunkMessages(messages, SINGLE_CALL_TOKEN_LIMIT, CHUNK_OVERLAP_TOKENS);
    const chunkResults: Array<{ boundaries: RawBoundary[]; globalStartIndex: number }> = [];

    for (const chunk of chunks) {
      const formatted = formatMessagesForBoundaryDetection(
        chunk.messages,
        chunk.globalStartIndex
      );
      const prompt = BOUNDARY_DETECTION_PROMPT.replace("{{content}}", formatted);
      const boundaries = await callClaudeJSON<RawBoundary[]>(anthropic, prompt, 4096);

      // The prompt shows global message indices ([MSG 0], [MSG 1], ...) via
      // formatMessagesForBoundaryDetection's globalStartIndex parameter, so Claude
      // returns global indices directly. We set globalStartIndex: 0 here to avoid
      // double-offsetting in mergeBoundaries (which adds globalStartIndex to each index).
      chunkResults.push({ boundaries, globalStartIndex: 0 });
    }

    const topicBoundaries = mergeBoundaries(chunkResults, messages.length);

    // 5. Pass 2: Per-topic Summarization
    const topics: Array<{
      id: number;
      name: string;
      title: string;
      stage: string;
      summary: string;
      messageRange: { start: number; end: number };
    }> = [];

    for (let i = 0; i < topicBoundaries.length; i++) {
      const boundary = topicBoundaries[i];
      const topicMessages = messages.slice(boundary.startIndex, boundary.endIndex + 1);

      // Check if topic is too large — truncate assistant messages if so
      const topicTokens = topicMessages.reduce(
        (sum, m) => sum + estimateTokens(m.text),
        0
      );
      const shouldTruncate = topicTokens > LARGE_TOPIC_TOKEN_LIMIT;

      const formatted = formatMessagesForSummarization(topicMessages, shouldTruncate);
      const prompt = TOPIC_SUMMARY_PROMPT
        .replace("{{topicName}}", boundary.name)
        .replace("{{content}}", formatted);

      const result = await callClaudeJSON<{
        name: string;
        title: string;
        stage: string;
        summary: string;
      }>(anthropic, prompt, 2048);

      // Validate stage
      const validStages = ["brainstorming", "design", "planning", "implemented", "verified"];
      const stage = validStages.includes(result.stage) ? result.stage : "brainstorming";

      topics.push({
        id: i + 1,
        name: result.name,
        title: result.title,
        stage,
        summary: result.summary,
        messageRange: { start: boundary.startIndex, end: boundary.endIndex },
      });
    }

    // 6. Pass 3: Session Title Synthesis
    const topicSummaries = topics
      .map((t) => `Topic ${t.id}: ${t.title}\n${t.summary}`)
      .join("\n\n");
    const titlePrompt = SESSION_TITLE_PROMPT.replace("{{content}}", topicSummaries);

    const titleResponse = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 256,
      temperature: 0,
      messages: [{ role: "user", content: titlePrompt }],
    });
    const titleBlock = titleResponse.content.find((b) => b.type === "text");
    const sessionTitle = titleBlock && titleBlock.type === "text"
      ? titleBlock.text.trim().replace(/^["']|["']$/g, "").slice(0, 80)
      : topics[0]?.title ?? "Claude Code Session";

    // 7. Store results
    const topicSegmentation = {
      sessionTitle,
      extractionModel: "claude-sonnet-4-20250514",
      extractedAt: Date.now(),
      pipelineVersion: "1.0",
      topics,
    };

    await ctx.runMutation(internal.knowledgeEntries.patchTopicSegmentation, {
      rawFileId,
      extractorName: "project-work-summary",
      topicSegmentation,
    });

    // 8. Update rawFile.displayName if not user-set
    await ctx.runMutation(internal.rawFiles.setDisplayName, {
      rawFileId,
      displayName: sessionTitle,
    });

    return { entryCount: topics.length };
  },
});
```

- [ ] **Step 4: Add `getByRawFileAndExtractor` internalQuery to knowledgeEntries.ts**

The `runTopicSegmentation` action needs to fetch the knowledge entry from within an action context (using `ctx.runQuery`). Add to `app/backend/convex/knowledgeEntries.ts`:

```typescript
export const getByRawFileAndExtractor = internalQuery({
  args: {
    rawFileId: v.id("rawFiles"),
    extractorName: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    return await ctx.db
      .query("knowledgeEntries")
      .withIndex("by_rawFile_extractor", (q) =>
        q.eq("rawFileId", args.rawFileId).eq("extractorName", args.extractorName)
      )
      .unique();
  },
});
```

**IMPORTANT:** `internalQuery` is NOT currently imported in `knowledgeEntries.ts`. Update the import at the top of the file from:
```typescript
import { query, mutation, internalMutation } from "./_generated/server";
```
to:
```typescript
import { query, mutation, internalMutation, internalQuery } from "./_generated/server";
```

- [ ] **Step 5: Verify build**

Run: `cd /Users/vinit/Tars/Content-Creation/feynman && pnpm build`

Verify no TypeScript errors.

- [ ] **Step 6: Commit**

```bash
git add app/backend/convex/extraction.ts app/backend/convex/knowledgeEntries.ts
git commit -m "feat: implement runTopicSegmentation 3-pass AI pipeline with chunking and boundary validation"
```

---

## Chunk 3: Frontend — Button, View, Renderer

### Task 5: Export Shared Components from ConversationRenderer

**Files:**
- Modify: `app/frontend/src/components/knowledge/renderers/conversation-renderer.tsx`

- [ ] **Step 1: Add `export` keyword to `MessageBubble` and `ToolCallChips`**

Find `function ToolCallChips(` and change to `export function ToolCallChips(`.

Find `function MessageBubble(` and change to `export function MessageBubble(`.

Also export the type interfaces so the topic renderer can use them:

Find `interface ConversationMessage {` and add `export` before it.
Find `interface ToolCallSummary {` and add `export` before it.

- [ ] **Step 2: Commit**

```bash
git add app/frontend/src/components/knowledge/renderers/conversation-renderer.tsx
git commit -m "feat: export MessageBubble, ToolCallChips, and type interfaces for reuse"
```

### Task 6: Build TopicSegmentationRenderer

**Files:**
- Create: `app/frontend/src/components/knowledge/renderers/topic-segmentation-renderer.tsx`

- [ ] **Step 1: Create the component file**

```typescript
"use client";

import { useState, useEffect, useCallback } from "react";
import { ChevronDown, ChevronRight, ChevronsUpDown, MessageSquare } from "lucide-react";
import {
  MessageBubble,
  ToolCallChips,
  type ConversationMessage,
} from "./conversation-renderer";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TopicSegment {
  id: number;
  name: string;
  title: string;
  stage: "brainstorming" | "design" | "planning" | "implemented" | "verified";
  summary: string;
  messageRange: { start: number; end: number };
}

interface TopicSegmentation {
  sessionTitle: string;
  extractionModel: string;
  extractedAt: number;
  pipelineVersion: string;
  topics: TopicSegment[];
}

interface TopicSegmentationRendererProps {
  topicSegmentation: TopicSegmentation;
  conversationMessages: ConversationMessage[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STAGE_CONFIG: Record<
  string,
  { label: string; bgClass: string; textClass: string }
> = {
  brainstorming: {
    label: "Brainstorming",
    bgClass: "bg-purple-100 dark:bg-purple-900/50",
    textClass: "text-purple-700 dark:text-purple-300",
  },
  design: {
    label: "Design/Spec",
    bgClass: "bg-blue-100 dark:bg-blue-900/50",
    textClass: "text-blue-700 dark:text-blue-300",
  },
  planning: {
    label: "Planning",
    bgClass: "bg-yellow-100 dark:bg-yellow-900/50",
    textClass: "text-yellow-700 dark:text-yellow-300",
  },
  implemented: {
    label: "Implemented",
    bgClass: "bg-green-100 dark:bg-green-900/50",
    textClass: "text-green-700 dark:text-green-300",
  },
  verified: {
    label: "Verified",
    bgClass: "bg-teal-100 dark:bg-teal-900/50",
    textClass: "text-teal-700 dark:text-teal-300",
  },
};

function formatTimeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function StageBadge({ stage }: { stage: string }) {
  const config = STAGE_CONFIG[stage] ?? STAGE_CONFIG.brainstorming;
  return (
    <span
      className={`text-xs font-medium px-1.5 py-0.5 rounded ${config.bgClass} ${config.textClass}`}
    >
      {config.label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Topic Accordion
// ---------------------------------------------------------------------------

function TopicAccordion({
  topic,
  messages,
  forceState,
}: {
  topic: TopicSegment;
  messages: ConversationMessage[];
  forceState: { expanded: boolean; version: number } | null;
}) {
  const [expanded, setExpanded] = useState(true);
  const [showMessages, setShowMessages] = useState(false);

  useEffect(() => {
    if (forceState) {
      setExpanded(forceState.expanded);
      if (!forceState.expanded) setShowMessages(false);
    }
  }, [forceState?.version]);

  const messageCount = topic.messageRange.end - topic.messageRange.start + 1;
  const topicMessages = messages.slice(
    topic.messageRange.start,
    topic.messageRange.end + 1
  );

  return (
    <div className="border rounded-lg overflow-hidden">
      {/* Topic header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-accent/30 transition-colors"
      >
        {expanded ? (
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        )}
        <span className="text-xs text-muted-foreground font-mono shrink-0">
          #{topic.id}
        </span>
        <span className="text-sm font-medium truncate flex-1">{topic.name}</span>
        <StageBadge stage={topic.stage} />
        <span className="text-xs text-muted-foreground shrink-0">
          {messageCount} msgs
        </span>
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="px-4 pb-3 space-y-3">
          {/* Title */}
          <p className="text-sm font-medium text-foreground/90">{topic.title}</p>

          {/* Summary */}
          <p className="text-sm text-muted-foreground leading-relaxed">
            {topic.summary}
          </p>

          {/* Show/hide messages toggle */}
          <button
            onClick={() => setShowMessages(!showMessages)}
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded-md bg-muted/50 hover:bg-muted"
          >
            <MessageSquare className="h-3 w-3" />
            {showMessages ? "Hide conversation" : `Show conversation (${messageCount} messages)`}
          </button>

          {/* Messages */}
          {showMessages && (
            <div className="space-y-2 pt-1">
              {topicMessages.map((msg, i) => (
                <MessageBubble
                  key={i}
                  message={msg}
                  collapseCommand={null}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export function TopicSegmentationRenderer({
  topicSegmentation,
  conversationMessages,
}: TopicSegmentationRendererProps) {
  const [forceState, setForceState] = useState<{
    expanded: boolean;
    version: number;
  } | null>(null);
  const [allExpanded, setAllExpanded] = useState(true);

  return (
    <div className="px-4 py-4 space-y-4">
      {/* Header */}
      <div className="space-y-1">
        <h3 className="text-lg font-semibold">{topicSegmentation.sessionTitle}</h3>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span>
            {topicSegmentation.topics.length}{" "}
            {topicSegmentation.topics.length === 1 ? "topic" : "topics"}
          </span>
          <span>Analyzed {formatTimeAgo(topicSegmentation.extractedAt)}</span>
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center justify-end">
        <button
          onClick={() => {
            const next = !allExpanded;
            setAllExpanded(next);
            setForceState((prev) => ({
              expanded: next,
              version: (prev?.version ?? 0) + 1,
            }));
          }}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded-md hover:bg-accent"
        >
          <ChevronsUpDown className="h-3 w-3" />
          {allExpanded ? "Collapse All" : "Expand All"}
        </button>
      </div>

      {/* Topic accordions */}
      <div className="space-y-3">
        {topicSegmentation.topics.map((topic) => (
          <TopicAccordion
            key={topic.id}
            topic={topic}
            messages={conversationMessages}
            forceState={forceState}
          />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add app/frontend/src/components/knowledge/renderers/topic-segmentation-renderer.tsx
git commit -m "feat: add TopicSegmentationRenderer with topic accordions, stage badges, and embedded messages"
```

### Task 7: Update SessionSlideOver with Analyze Button and Topic Summary View

**Files:**
- Modify: `app/frontend/src/components/knowledge/session-slide-over.tsx`

- [ ] **Step 1: Add imports**

Add to the imports at the top of `session-slide-over.tsx`:

1. `useMutation` is already imported alongside `useQuery` — no change needed.

2. Add the TopicSegmentationRenderer import after the ConversationRenderer import:
```typescript
import { TopicSegmentationRenderer } from "@/components/knowledge/renderers/topic-segmentation-renderer";
```

3. Update the lucide-react import to add `Sparkles` and `Loader2`. Change:
```typescript
import { X, ChevronDown, ChevronRight, Pencil } from "lucide-react";
```
to:
```typescript
import { X, ChevronDown, ChevronRight, Pencil, Sparkles, Loader2 } from "lucide-react";
```

- [ ] **Step 2: Add live rawFile query and topic segmentation mutation**

Inside the `SessionSlideOver` component, after the existing queries, add:

```typescript
  // Live query for rawFile status (props may be a stale snapshot)
  const liveRawFile = useQuery(api.rawFiles.getByIdPublic, {
    id: rawFile._id as Id<"rawFiles">,
  });
  const currentRawFile = liveRawFile ?? rawFile;

  // Topic segmentation trigger
  const triggerTopicSegmentation = useMutation(api.rawFiles.triggerTopicSegmentation);

  // Detect topic segmentation status
  const topicSegStatus = (currentRawFile.extractionResults ?? []).find(
    (r: any) => r.extractorName === "topic-segmentation"
  );
  const isAnalyzing =
    topicSegStatus?.status === "pending" || topicSegStatus?.status === "running";
  const analysisFailed = topicSegStatus?.status === "failed";
```

- [ ] **Step 3: Check if topic segmentation exists on the knowledge entry**

After the existing `selectedEntry` derivation, add:

```typescript
  // Check if topic segmentation data exists
  const workSummaryEntry = entryList.find(
    (e: any) => e.extractorName === "project-work-summary"
  );
  const hasTopicSegmentation = !!workSummaryEntry?.topicSegmentation;
```

- [ ] **Step 4: Update the default view selection to prefer Topic Summary**

Find the `useEffect` that sets the default selected view (the one with `extractorList.length` dependency). Update it to:

```typescript
  // Default to first extractor when data loads, or topic-summary if available
  useEffect(() => {
    if (extractorList.length > 0 && !selectedView) {
      if (hasTopicSegmentation) {
        setSelectedView("topic-summary");
      } else {
        setSelectedView(extractorList[0].name);
      }
    }
  }, [extractorList.length, hasTopicSegmentation]);
```

- [ ] **Step 5: Add "Topic Summary" option to the View dropdown and "Analyze Topics" button**

Find the View selector `<select>` element. Add the "Topic Summary" option conditionally, and add the Analyze button after the select:

Replace the entire view selector div (search for `{/* View selector */}`):

```typescript
          {/* View selector */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-muted-foreground">View:</span>
            <select
              value={selectedView}
              onChange={(e) => {
                setSelectedView(e.target.value);
                setContentMode("rendered");
              }}
              className="text-sm border rounded-md px-2 py-1 bg-background min-w-[200px]"
            >
              {hasTopicSegmentation && (
                <option value="topic-summary">Topic Summary</option>
              )}
              {extractorList.map((ex: any) => (
                <option key={ex.name} value={ex.name}>
                  {ex.displayName}
                </option>
              ))}
              <option value="raw">Raw Transcript</option>
            </select>
            <button
              onClick={() =>
                triggerTopicSegmentation({
                  rawFileId: rawFile._id as Id<"rawFiles">,
                })
              }
              disabled={isAnalyzing}
              className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border transition-colors ${
                isAnalyzing
                  ? "opacity-50 cursor-not-allowed"
                  : analysisFailed
                    ? "border-destructive/50 text-destructive hover:bg-destructive/10"
                    : "hover:bg-accent"
              }`}
            >
              {isAnalyzing ? (
                <>
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Analyzing...
                </>
              ) : analysisFailed ? (
                <>
                  <Sparkles className="h-3 w-3" />
                  Retry Analysis
                </>
              ) : (
                <>
                  <Sparkles className="h-3 w-3" />
                  Analyze Topics
                </>
              )}
            </button>
          </div>
```

- [ ] **Step 6: Add Topic Summary rendering in the content area**

Find the content rendering section (the `{selectedView === "raw" ? (` block). Before the raw view check, add a check for "topic-summary":

The content area currently has:
```typescript
        <div className="flex-1 overflow-y-auto">
          {selectedView === "raw" ? (
            // Raw transcript view
```

Change to:
```typescript
        <div className="flex-1 overflow-y-auto">
          {selectedView === "topic-summary" && workSummaryEntry?.topicSegmentation ? (
            <TopicSegmentationRenderer
              topicSegmentation={workSummaryEntry.topicSegmentation}
              conversationMessages={(() => {
                try {
                  return JSON.parse(workSummaryEntry.content);
                } catch {
                  return [];
                }
              })()}
            />
          ) : selectedView === "raw" ? (
            // Raw transcript view
```

- [ ] **Step 7: Verify build**

Run: `cd /Users/vinit/Tars/Content-Creation/feynman && pnpm build`

- [ ] **Step 8: Commit**

```bash
git add app/frontend/src/components/knowledge/session-slide-over.tsx
git commit -m "feat: add Analyze Topics button, live status, and Topic Summary view in slide-over"
```

---

## Chunk 4: Verification

### Task 8: End-to-End Verification

- [ ] **Step 1: Deploy backend**

Run: `pnpm dev:backend`

Verify schema pushes successfully (the new `topicSegmentation` field).

- [ ] **Step 2: Re-extract to get untruncated content**

Since we changed the truncation cap, existing entries may have truncated content. Run:

```bash
pnpm reextract:claude
```

This re-runs the mechanical parser with the new 900KB cap.

- [ ] **Step 3: Start frontend and test**

Run: `pnpm dev`

Navigate to Claude Transcripts page. Open a session slide-over. Verify:
- "Analyze Topics" button appears below the View dropdown
- Click it — button changes to "Analyzing..." with spinner
- After completion (may take 30-60 seconds for 3+ API calls):
  - "Topic Summary" appears in the View dropdown
  - It becomes the selected view
  - Topics show as accordions with name, stage badge, message count
  - Expanding a topic shows title, summary, and "Show conversation" button
  - Clicking "Show conversation" reveals the actual messages with bubbles
  - Session title in the list updates (if not manually renamed)
- Test with a session that has only one topic — should show a single topic
- Test "Analyze Topics" again (re-run) — should overwrite previous results
- Verify the "Project Work Summary" view still works (unchanged)
- Verify the "Raw Transcript" view still works (unchanged)

- [ ] **Step 4: Commit any fixes**

```bash
git status
git add <specific files>
git commit -m "fix: address issues found during verification"
```
