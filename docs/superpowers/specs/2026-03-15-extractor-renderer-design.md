# Extractor Renderer & Parser Improvement Design

**Date:** 2026-03-15
**Status:** Approved
**Scope:** Improve the mechanical parser output format and introduce custom per-extractor React renderers for the transcript slide-over.

---

## Problem

The current "project-work-summary" extractor produces a flat markdown string with `### Human` / `### Assistant` headings separated by `---`. This creates three problems:

1. **No visual distinction** between human and assistant messages — they look identical except for the heading text.
2. **Tool noise** — tool_result records appear as separate "Assistant" messages (e.g., three assistant blocks in a row where the middle ones are command output), breaking the reading flow.
3. **No per-message timestamps** — the parser discards `record.timestamp` from the JSONL, so you can't tell when each exchange happened.

The rendering is also locked to `<ReactMarkdown>` for all extractors, with no way for an extractor to provide its own visual treatment.

## Solution

Three coordinated changes:

1. **Rewrite the parser** to output structured JSON (array of message objects) instead of markdown.
2. **Add a `rendererType` field** to the extractors table, allowing each extractor to declare how its output should be rendered.
3. **Build a `ConversationRenderer` component** that renders the structured JSON as a chat-style interface.

---

## Data Model

### ConversationMessage format

The parser outputs a JSON array of message objects, serialized as a string in `knowledgeEntries.content`:

```typescript
interface ConversationMessage {
  role: "human" | "assistant";
  text: string;                    // All text blocks joined with newlines
  timestamp?: string;              // ISO timestamp from the JSONL record
  toolCalls?: ToolCallSummary[];   // Tool activity associated with this message
}

interface ToolCallSummary {
  tool: string;                    // "bash", "edit", "read", "glob", etc.
  shortDescription: string;        // "grep -r 'auth' src/", "edited src/auth.ts:42-58"
}
```

Example stored content:

```json
[
  {
    "role": "human",
    "text": "Fix the auth bug in the login flow",
    "timestamp": "2026-03-15T10:00:00Z"
  },
  {
    "role": "assistant",
    "text": "Let me look at that...\n\nDone — I've fixed the edge case in the authentication logic.",
    "timestamp": "2026-03-15T10:00:05Z",
    "toolCalls": [
      { "tool": "bash", "shortDescription": "grep -r 'authenticate' src/" },
      { "tool": "edit", "shortDescription": "src/auth.ts:42-58" }
    ]
  }
]
```

### Schema change

Add `rendererType` to the `extractors` table:

```typescript
rendererType: v.optional(v.string()),  // "conversation", or absent for default markdown
```

No other schema changes. The `knowledgeEntries.content` field remains `v.string()` — it just holds JSON now instead of markdown for this extractor.

---

## Parser Changes (`parseClaudeStripTools`)

**File:** `app/backend/convex/extraction.ts`

The parser currently iterates JSONL records, skips meta/sidechain, extracts text blocks, and builds markdown. The rewrite changes the output format while keeping the same filtering logic.

### Key logic changes

1. **Output structured messages instead of markdown.** Build an array of `ConversationMessage` objects. Serialize to JSON string at the end.

2. **Merge consecutive assistant messages.** When the current JSONL record is `type: "assistant"` and the previous message in the array is also `role: "assistant"`, append the text to the existing message and add any tool calls to its `toolCalls` array. This collapses tool_result records into the preceding assistant turn.

3. **Extract tool summaries from `tool_use` blocks only.** Only `tool_use` content blocks contribute to the `toolCalls` array — `tool_result` blocks are ignored (they are output, not actions). For each `tool_use` block:
   - `tool`: the `name` field (e.g., "bash", "edit", "read", "glob", "grep")
   - `shortDescription`: derived from the tool input:
     - `bash`: first 80 chars of `input.command`
     - `edit`/`read`/`write`: `input.file_path` (basename or last 60 chars if long)
     - `glob`/`grep`: `input.pattern` (truncated to 60 chars)
     - Other tools: tool name only

4. **Handle tool-only messages.** If an assistant JSONL record contains only `tool_use`/`tool_result` blocks and no `text` blocks, it produces no new message — its tool summaries are appended to the previous assistant message's `toolCalls` array. If there is no previous assistant message, create one with empty text.

5. **Preserve timestamps.** Pull `record.timestamp` from each JSONL record and include it in the message object. If `timestamp` is missing or unparseable, omit it from the message object (the field is optional).

6. **Provide a `messagesToReadableText` helper.** Extract a standalone function that converts a `ConversationMessage[]` array into a plain-text string suitable for AI prompt injection. Output format:

   ```
   ### Human

   {message text}

   ---

   ### Assistant

   {message text}

   ---
   ```

   This mirrors the old markdown output (which the AI prompt was designed for) but is generated from the structured data. Tool calls are omitted from this text representation.

   **Where it's called:** In the AI extractor path of `runExtractor` in `extraction.ts` (around line 230-236). Currently the AI path does:
   ```typescript
   const parsed = cleanParser(rawText);
   prompt = prompt.replace(/\{\{content\}\}/g, parsed.content.slice(0, 30_000));
   ```
   After the rewrite, `parsed.content` is a JSON string. The AI path must instead do:
   ```typescript
   const parsed = cleanParser(rawText);
   const readableText = messagesToReadableText(JSON.parse(parsed.content));
   prompt = prompt.replace(/\{\{content\}\}/g, readableText.slice(0, 30_000));
   ```

### Title derivation

Title derivation logic stays the same — derived from the first meaningful human message text. Note: the existing `deriveTitle` function checks for `role === "Human"` (capitalized). This must be updated to match the new lowercase `role: "human"` convention.

### ParseResult output

```typescript
{
  title: string,                           // Same derivation as before
  content: JSON.stringify(messages),       // JSON array of ConversationMessage
  tags: string[],                          // [projectName] if present
  metadata: {
    messageCount: messages.length,
    parser: "claude-strip-tools",
    projectPath?: string,
    projectName?: string,
    format: "conversation-json"            // New: signals the content format
  }
}
```

The `metadata.format` field is for debugging/observability only — the renderer selection is driven by the extractor's `rendererType`, not by this field. It can be removed if it adds confusion; it has no runtime consumer.

### Content cap

The 50,000 character cap applies to the serialized JSON string. **Important:** Truncation must happen at message boundaries — drop trailing messages from the array until the serialized JSON is under the cap. Do not slice the JSON string mid-message, as that would produce invalid JSON that the renderer cannot parse.

---

## Renderer Architecture

### Extractor seed update

**File:** `app/backend/convex/extractors.ts`

Update the "project-work-summary" extractor seed to include:

```typescript
rendererType: "conversation"
```

The "engineering-decisions" extractor keeps no `rendererType` (defaults to markdown rendering).

### SessionSlideOver changes

**File:** `app/frontend/src/components/knowledge/session-slide-over.tsx`

When rendering an extractor's content, the slide-over checks the extractor's `rendererType`:

```typescript
// Renderer registry
const RENDERERS: Record<string, React.ComponentType<{ data: string }>> = {
  conversation: ConversationRenderer,
};

// In the render logic:
const Renderer = selectedExtractor?.rendererType
  ? RENDERERS[selectedExtractor.rendererType]
  : undefined;

if (Renderer) {
  return <Renderer data={selectedEntry.content} />;
} else if (selectedExtractor?.rendererType) {
  // rendererType is set but not found in registry — show warning
  return <p>Unknown renderer: {selectedExtractor.rendererType}</p>;
} else {
  // No rendererType — fall back to current ReactMarkdown behavior
  return <ReactMarkdown>{selectedEntry.content}</ReactMarkdown>;
}
```

The Rendered/Raw toggle still works:
- **Rendered:** Uses the custom renderer (or ReactMarkdown fallback)
- **Raw:** Shows the raw content in a `<pre>` block. For JSON content, pretty-print with `JSON.stringify(JSON.parse(content), null, 2)` so it's readable. For markdown content (legacy extractors), show as-is.

To support this, the slide-over needs access to the extractor record (not just the entry). It already queries `api.extractors.list` for the dropdown, so the extractor metadata is available.

### ConversationRenderer component

**File:** `app/frontend/src/components/knowledge/renderers/conversation-renderer.tsx`

**Props:** `{ data: string }` — the JSON string from `knowledgeEntries.content`

**Behavior:**

1. Parse the JSON string into `ConversationMessage[]`. If parsing fails, show a fallback error message.

2. Render each message as a visual block:

   **Human messages:**
   - Distinct background tint (e.g., blue-50/indigo-50 in light mode, blue-950/indigo-950 in dark mode)
   - "You" label in a small badge, top-left
   - Timestamp top-right, muted text
   - Message text rendered with ReactMarkdown (messages contain code blocks, lists, etc.)
   - Left border accent for quick scanning

   **Assistant messages:**
   - Different background tint (e.g., gray-50 light, gray-900 dark)
   - "Claude" label in a small badge, top-left
   - Timestamp top-right, muted text
   - Message text rendered with ReactMarkdown
   - Left border accent in a different color

   **Tool call chips (within assistant messages):**
   - Appear after the message text
   - Collapsed by default: shows a single line like "3 tool calls" or "bash, edit, read"
   - Click to expand: shows each tool call as `tool: shortDescription`
   - Muted, small styling — should not compete with message text visually
   - Optional: small icon per tool type (terminal icon for bash, file icon for edit/read/write)

3. **Spacing:** Clear visual gap between human→assistant and assistant→human transitions. Tighter spacing within consecutive same-role messages (though these should be rare after merging).

4. **Dark mode support:** Use Tailwind's `dark:` variants. The component should respect the existing theme.

---

## Migration & Re-ingestion

1. **No data migration needed.** The schema change (adding `rendererType` to extractors) is additive. Existing extractor rows without the field default to markdown rendering.

2. **Extractor seed update.** The seed/upsert logic in `extractors.ts` adds `rendererType: "conversation"` to the "project-work-summary" extractor. This happens on the next Convex deploy.

3. **Re-ingestion required.** After deploying the parser changes, run:
   ```bash
   pnpm cleanup:claude
   pnpm ingest:claude
   ```
   This wipes existing rawFiles + knowledgeEntries and re-ingests. The parser auto-runs on upload, producing the new JSON format.

4. **Backward compatibility.** The ConversationRenderer wraps its `JSON.parse` in a try-catch. If parsing fails (stale markdown data), it renders a fallback message suggesting re-ingestion.

---

## Files Changed

| File | Change |
|------|--------|
| `app/backend/convex/schema.ts` | Add `rendererType: v.optional(v.string())` to extractors table |
| `app/backend/convex/extractors.ts` | Add `rendererType: "conversation"` to "project-work-summary" seed |
| `app/backend/convex/extraction.ts` | Rewrite `parseClaudeStripTools` to output JSON array of ConversationMessage; add `messagesToReadableText` helper; fix `deriveTitle` role casing; update AI extractor path to use helper |
| `app/frontend/src/components/knowledge/session-slide-over.tsx` | Add renderer registry and lookup logic |
| `app/frontend/src/components/knowledge/renderers/conversation-renderer.tsx` | **New:** Chat-bubble renderer for conversation JSON |

## What stays the same

- Raw JSONL files in Convex storage (untouched)
- "Raw Transcript" view in the slide-over (unchanged)
- "engineering-decisions" AI extractor (no rendererType, keeps ReactMarkdown rendering)
- The Rendered/Raw toggle behavior
- Ingestion pipeline (no changes)
- SessionList component (no changes)

## Implementation ordering

The changes have these dependencies:

1. **Schema first** — add `rendererType` to extractors table in `schema.ts`
2. **Parser + helpers** — rewrite `parseClaudeStripTools`, add `messagesToReadableText`, fix `deriveTitle` role casing, update AI extractor path — all in `extraction.ts`
3. **Extractor seed** — add `rendererType: "conversation"` to seed in `extractors.ts` (requires schema from step 1)
4. **Frontend** — build ConversationRenderer, update SessionSlideOver with renderer registry (can be done in parallel with step 2-3)
5. **Deploy + re-ingest** — deploy backend, run seed, then `pnpm cleanup:claude && pnpm ingest:claude`

## Future extensions

This design enables:
- **AI topic segmentation:** A future AI extractor can consume the structured JSON and produce topic-grouped summaries
- **Cross-session threading:** The structured format makes it possible to identify related topics across sessions
- **New extractor renderers:** Any future extractor can declare a `rendererType` and get custom rendering
