# Extractor Renderer & Parser Improvement Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite the Claude transcript parser to output structured JSON, add a per-extractor renderer system, and build a chat-bubble ConversationRenderer component.

**Architecture:** The parser (`parseClaudeStripTools`) changes from producing markdown to producing a JSON array of `ConversationMessage` objects. A new `rendererType` field on the `extractors` table drives a renderer registry in the frontend. The `ConversationRenderer` component renders the structured data as a chat-style interface with distinct human/assistant styling and collapsed tool call chips.

**Tech Stack:** Convex (schema, mutations, queries), Next.js App Router, React, Tailwind CSS, ReactMarkdown, TypeScript

**Spec:** `docs/superpowers/specs/2026-03-15-extractor-renderer-design.md`

---

## Chunk 1: Backend — Schema, Parser Rewrite, Seed Update

### Task 1: Add `rendererType` to Extractors Schema

**Files:**
- Modify: `app/backend/convex/schema.ts`

- [ ] **Step 1: Add `rendererType` field to extractors table**

In `app/backend/convex/schema.ts`, add `rendererType` to the `extractors` table definition, after the `promptTemplate` field:

```typescript
rendererType: v.optional(v.string()),  // "conversation", or absent for default markdown
```

The full extractors table should now be:

```typescript
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
    rendererType: v.optional(v.string()),
  })
    .index("by_source", ["source"])
    .index("by_source_name", ["source", "name"]),
```

- [ ] **Step 2: Commit**

```bash
git add app/backend/convex/schema.ts
git commit -m "feat: add rendererType field to extractors schema"
```

### Task 2: Rewrite `parseClaudeStripTools` Parser

**Files:**
- Modify: `app/backend/convex/extraction.ts`

This is the largest task — the parser rewrite, helper functions, deriveTitle fix, and AI extractor path update.

- [ ] **Step 1: Add TypeScript interfaces at the top of extraction.ts**

After the existing `ParseResult` and `ParserFn` type definitions (around line 16), add the conversation message types:

```typescript
interface ConversationMessage {
  role: "human" | "assistant";
  text: string;
  timestamp?: string;
  toolCalls?: ToolCallSummary[];
}

interface ToolCallSummary {
  tool: string;
  shortDescription: string;
}
```

- [ ] **Step 2: Add `deriveToolDescription` helper**

Add this before the `deriveTitle` function:

```typescript
function deriveToolDescription(toolName: string, input: Record<string, unknown>): string {
  switch (toolName) {
    case "bash": {
      const cmd = typeof input.command === "string" ? input.command : "";
      return cmd.length > 80 ? cmd.slice(0, 77) + "..." : cmd;
    }
    case "edit":
    case "read":
    case "write": {
      const filePath = typeof input.file_path === "string" ? input.file_path : "";
      if (filePath.length > 60) {
        return "..." + filePath.slice(-57);
      }
      return filePath;
    }
    case "glob":
    case "grep": {
      const pattern = typeof input.pattern === "string" ? input.pattern : "";
      return pattern.length > 60 ? pattern.slice(0, 57) + "..." : pattern;
    }
    default:
      return toolName;
  }
}
```

- [ ] **Step 3: Fix `deriveTitle` role casing**

In the `deriveTitle` function, find the line:

```typescript
if (msg.role !== "Human") continue;
```

and change it to:

```typescript
if (msg.role !== "human") continue;
```

- [ ] **Step 4: Add `messagesToReadableText` helper**

Add after `deriveTitle`:

```typescript
/**
 * Convert structured messages back to readable text for AI prompt injection.
 * Mirrors the old markdown output format.
 */
function messagesToReadableText(messages: ConversationMessage[]): string {
  return messages
    .map((m) => {
      const roleLabel = m.role === "human" ? "Human" : "Assistant";
      return `### ${roleLabel}\n\n${m.text}`;
    })
    .join("\n\n---\n\n");
}
```

- [ ] **Step 5: Rewrite `parseClaudeStripTools` function body**

Replace the entire `parseClaudeStripTools` function body (find `function parseClaudeStripTools(`) with:

```typescript
function parseClaudeStripTools(rawText: string, projectPath?: string, projectName?: string): ParseResult {
  const lines = rawText.split("\n").filter((l) => l.trim().length > 0);

  const messages: ConversationMessage[] = [];

  for (const line of lines) {
    let record: Record<string, unknown>;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }

    // Skip meta / sidechain messages
    if (record.isMeta || record.isSidechain) continue;

    const type = record.type as string | undefined;
    if (type !== "user" && type !== "assistant") continue;

    // Extract timestamp
    const timestamp = typeof record.timestamp === "string" ? record.timestamp : undefined;

    // Extract content blocks
    const messageContent = record.message as { content?: unknown } | undefined;
    if (!messageContent) continue;

    const contentArr = Array.isArray(messageContent.content)
      ? (messageContent.content as Array<Record<string, unknown>>)
      : [];

    const textParts: string[] = [];
    const toolCalls: ToolCallSummary[] = [];

    for (const block of contentArr) {
      if (block.type === "text" && typeof block.text === "string") {
        textParts.push(block.text);
      } else if (block.type === "tool_use" && typeof block.name === "string") {
        const input = (block.input as Record<string, unknown>) ?? {};
        toolCalls.push({
          tool: block.name,
          shortDescription: deriveToolDescription(block.name, input),
        });
      }
      // tool_result blocks are ignored — they are output, not actions
    }

    const role: "human" | "assistant" = type === "user" ? "human" : "assistant";
    const text = textParts.join("\n");

    // Merge consecutive assistant messages
    const prevMessage = messages.length > 0 ? messages[messages.length - 1] : null;
    if (role === "assistant" && prevMessage?.role === "assistant") {
      // Append text (if any) to previous message
      if (text) {
        prevMessage.text = prevMessage.text
          ? prevMessage.text + "\n\n" + text
          : text;
      }
      // Append tool calls to previous message
      if (toolCalls.length > 0) {
        prevMessage.toolCalls = [...(prevMessage.toolCalls ?? []), ...toolCalls];
      }
      // Update timestamp to latest
      if (timestamp) {
        prevMessage.timestamp = timestamp;
      }
      continue;
    }

    // Tool-only message with no text — attach to previous assistant message
    if (text.length === 0 && toolCalls.length > 0 && prevMessage?.role === "assistant") {
      prevMessage.toolCalls = [...(prevMessage.toolCalls ?? []), ...toolCalls];
      continue;
    }

    // Skip records with no text and no tool calls
    if (text.length === 0 && toolCalls.length === 0) continue;

    const msg: ConversationMessage = { role, text };
    if (timestamp) msg.timestamp = timestamp;
    if (toolCalls.length > 0) msg.toolCalls = toolCalls;
    messages.push(msg);
  }

  // Derive title from first meaningful human message
  const title = deriveTitle(messages);

  // Serialize to JSON, truncating at message boundaries if over 50K
  let content: string;
  let truncatedMessages = messages;
  content = JSON.stringify(truncatedMessages);
  while (content.length > 50_000 && truncatedMessages.length > 1) {
    truncatedMessages = truncatedMessages.slice(0, -1);
    content = JSON.stringify(truncatedMessages);
  }

  // Build tags from projectName
  const tags: string[] = [];
  if (projectName) tags.push(projectName);

  return {
    title,
    content,
    tags,
    metadata: {
      messageCount: messages.length,
      parser: "claude-strip-tools",
      format: "conversation-json",
      ...(projectPath ? { projectPath } : {}),
      ...(projectName ? { projectName } : {}),
    },
  };
}
```

- [ ] **Step 6: Update AI extractor path to use `messagesToReadableText`**

In the `runExtractor` handler, find the AI extractor section (search for `// Use mechanical parser to get clean conversation text`). Change:

```typescript
      // Use mechanical parser to get clean conversation text
      const cleanParser = PARSERS["claude-strip-tools"];
      const parsed = cleanParser(rawText);

      // Substitute template variables
      let prompt = extractor.promptTemplate;
      prompt = prompt.replace(/\{\{content\}\}/g, parsed.content.slice(0, 30_000));
```

to:

```typescript
      // Use mechanical parser to get structured conversation, then convert to readable text for AI
      const cleanParser = PARSERS["claude-strip-tools"];
      const parsed = cleanParser(rawText);
      const readableText = messagesToReadableText(
        JSON.parse(parsed.content) as ConversationMessage[]
      );

      // Substitute template variables
      let prompt = extractor.promptTemplate;
      prompt = prompt.replace(/\{\{content\}\}/g, readableText.slice(0, 30_000));
```

- [ ] **Step 7: Verify build**

Run: `cd /Users/vinit/Tars/Content-Creation/feynman && pnpm build`

Verify the build passes with no TypeScript errors.

- [ ] **Step 8: Commit**

```bash
git add app/backend/convex/extraction.ts
git commit -m "feat: rewrite parseClaudeStripTools to output structured JSON with tool summaries"
```

### Task 3: Update Extractor Seed

**Files:**
- Modify: `app/backend/convex/extractors.ts`

- [ ] **Step 1: Add `rendererType` to project-work-summary seed**

In `app/backend/convex/extractors.ts`, update the `workSummaryData` object in the `seed` mutation to include `rendererType`:

```typescript
    const workSummaryData = {
      source: workSummarySource,
      name: "project-work-summary",
      displayName: "Project Work Summary",
      description: "Extracts a mechanical summary of project work performed in a Claude session",
      type: "mechanical" as const,
      parserName: "claude-strip-tools",
      autoRun: true,
      enabled: true,
      rendererType: "conversation",
    };
```

- [ ] **Step 2: Commit**

```bash
git add app/backend/convex/extractors.ts
git commit -m "feat: add rendererType to project-work-summary extractor seed"
```

---

## Chunk 2: Frontend — Renderer Registry & ConversationRenderer

### Task 4: Build ConversationRenderer Component

**Files:**
- Create: `app/frontend/src/components/knowledge/renderers/conversation-renderer.tsx`

- [ ] **Step 1: Create the renderers directory and component file**

```typescript
"use client";

import { useState, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import { ChevronDown, ChevronRight, Terminal, FileText } from "lucide-react";

// ---------------------------------------------------------------------------
// Types (mirrors backend ConversationMessage)
// ---------------------------------------------------------------------------

interface ConversationMessage {
  role: "human" | "assistant";
  text: string;
  timestamp?: string;
  toolCalls?: ToolCallSummary[];
}

interface ToolCallSummary {
  tool: string;
  shortDescription: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTimestamp(ts: string): string {
  const d = new Date(ts);
  if (isNaN(d.getTime())) return ts;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function toolIcon(tool: string) {
  switch (tool) {
    case "bash":
      return <Terminal className="h-3 w-3" />;
    default:
      return <FileText className="h-3 w-3" />;
  }
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ToolCallChips({ toolCalls }: { toolCalls: ToolCallSummary[] }) {
  const [expanded, setExpanded] = useState(false);

  if (toolCalls.length === 0) return null;

  const summary =
    toolCalls.length <= 3
      ? toolCalls.map((tc) => tc.tool).join(", ")
      : `${toolCalls.length} tool calls`;

  return (
    <div className="mt-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded-md bg-muted/50 hover:bg-muted"
      >
        {expanded ? (
          <ChevronDown className="h-3 w-3" />
        ) : (
          <ChevronRight className="h-3 w-3" />
        )}
        <Terminal className="h-3 w-3" />
        <span>{summary}</span>
      </button>
      {expanded && (
        <div className="mt-1.5 space-y-0.5 pl-2 border-l-2 border-muted ml-1">
          {toolCalls.map((tc, i) => (
            <div
              key={i}
              className="flex items-center gap-1.5 text-xs text-muted-foreground font-mono"
            >
              {toolIcon(tc.tool)}
              <span className="font-medium">{tc.tool}</span>
              <span className="truncate">{tc.shortDescription}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MessageBubble({ message }: { message: ConversationMessage }) {
  const isHuman = message.role === "human";

  return (
    <div
      className={`px-4 py-3 rounded-lg ${
        isHuman
          ? "bg-blue-50 dark:bg-blue-950/30 border-l-3 border-l-blue-400 dark:border-l-blue-600"
          : "bg-gray-50 dark:bg-gray-800/50 border-l-3 border-l-gray-300 dark:border-l-gray-600"
      }`}
    >
      {/* Header: role badge + timestamp */}
      <div className="flex items-center justify-between mb-2">
        <span
          className={`text-xs font-semibold px-1.5 py-0.5 rounded ${
            isHuman
              ? "bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300"
              : "bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300"
          }`}
        >
          {isHuman ? "You" : "Claude"}
        </span>
        {message.timestamp && (
          <span className="text-xs text-muted-foreground">
            {formatTimestamp(message.timestamp)}
          </span>
        )}
      </div>

      {/* Message text */}
      {message.text && (
        <div className="prose prose-sm dark:prose-invert max-w-none [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
          <ReactMarkdown>{message.text}</ReactMarkdown>
        </div>
      )}

      {/* Tool calls */}
      {message.toolCalls && message.toolCalls.length > 0 && (
        <ToolCallChips toolCalls={message.toolCalls} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface ConversationRendererProps {
  data: string;
}

export function ConversationRenderer({ data }: ConversationRendererProps) {
  const messages = useMemo(() => {
    try {
      const parsed = JSON.parse(data);
      if (!Array.isArray(parsed)) return null;
      return parsed as ConversationMessage[];
    } catch {
      return null;
    }
  }, [data]);

  if (!messages) {
    return (
      <div className="px-5 py-8 text-center">
        <p className="text-sm text-muted-foreground">
          Unable to parse conversation data. This may be stale data from before the parser update.
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          Run <code className="bg-muted px-1 rounded">pnpm cleanup:claude && pnpm ingest:claude</code> to re-ingest.
        </p>
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div className="px-5 py-8 text-center">
        <p className="text-sm text-muted-foreground">No messages in this session.</p>
      </div>
    );
  }

  return (
    <div className="px-4 py-4 space-y-3">
      {messages.map((msg, i) => (
        <MessageBubble key={i} message={msg} />
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add app/frontend/src/components/knowledge/renderers/conversation-renderer.tsx
git commit -m "feat: add ConversationRenderer with chat-bubble styling and tool call chips"
```

### Task 5: Update SessionSlideOver with Renderer Registry

**Files:**
- Modify: `app/frontend/src/components/knowledge/session-slide-over.tsx`

- [ ] **Step 1: Add import for ConversationRenderer**

At the top of `session-slide-over.tsx`, add:

```typescript
import { ConversationRenderer } from "@/components/knowledge/renderers/conversation-renderer";
```

- [ ] **Step 2: Add renderer registry constant**

After the imports, before the interfaces, add:

```typescript
// Renderer registry — maps rendererType to a component that handles that format
const RENDERERS: Record<string, React.ComponentType<{ data: string }>> = {
  conversation: ConversationRenderer,
};
```

- [ ] **Step 3: Find the selected extractor record for renderer lookup**

Inside the `SessionSlideOver` component, after the existing `selectedEntry` derivation, add a lookup for the extractor record:

```typescript
  // Find the extractor record for the selected view (needed for rendererType)
  const selectedExtractor = selectedView !== "raw"
    ? extractorList.find((ex: any) => ex.name === selectedView)
    : null;
```

- [ ] **Step 4: Replace the extractor content rendering with renderer lookup**

Find the section where the extractor view renders the entry content. Look for the `{contentMode === "rendered" ? (` block inside the `<div className="px-5 py-4">` wrapper in the extractor view section. Replace the **inner content** of that wrapper div (keep the `px-5 py-4` wrapper intact):

From (the content inside `<div className="px-5 py-4">`):
```typescript
{contentMode === "rendered" ? (
  <div className="prose prose-sm dark:prose-invert max-w-none">
    <ReactMarkdown>{selectedEntry.content}</ReactMarkdown>
  </div>
) : (
  <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed">
    {selectedEntry.content}
  </pre>
)}
```

Replace with:
```typescript
{contentMode === "rendered" ? (
  (() => {
    const Renderer = selectedExtractor?.rendererType
      ? RENDERERS[selectedExtractor.rendererType]
      : undefined;
    if (Renderer) {
      return <Renderer data={selectedEntry.content} />;
    } else if (selectedExtractor?.rendererType) {
      return (
        <div className="px-5 py-8 text-center">
          <p className="text-sm text-muted-foreground">
            Unknown renderer: {selectedExtractor.rendererType}
          </p>
        </div>
      );
    }
    return (
      <div className="prose prose-sm dark:prose-invert max-w-none">
        <ReactMarkdown>{selectedEntry.content}</ReactMarkdown>
      </div>
    );
  })()
) : (
  <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed">
    {(() => {
      try {
        return JSON.stringify(JSON.parse(selectedEntry.content), null, 2);
      } catch {
        return selectedEntry.content;
      }
    })()}
  </pre>
)}
```

Note: The "Raw" mode now pretty-prints JSON content, falling back to as-is for non-JSON (markdown) content.

- [ ] **Step 5: Verify build**

Run: `cd /Users/vinit/Tars/Content-Creation/feynman && pnpm build`

Verify the build passes with no TypeScript errors.

- [ ] **Step 6: Commit**

```bash
git add app/frontend/src/components/knowledge/session-slide-over.tsx
git commit -m "feat: add renderer registry to SessionSlideOver with JSON pretty-print in raw view"
```

---

## Chunk 3: Deploy, Seed, & Verification

### Task 6: Deploy and Re-ingest

- [ ] **Step 1: Deploy backend**

Run: `cd app/backend && pnpm exec convex dev`

Verify schema pushes successfully (the new `rendererType` field on extractors).

- [ ] **Step 2: Run extractor seed**

Run the seed mutation from the Convex dashboard or CLI to update the "project-work-summary" extractor with `rendererType: "conversation"`.

- [ ] **Step 3: Clean up and re-ingest**

```bash
pnpm cleanup:claude
pnpm ingest:claude
```

- [ ] **Step 4: Verify in browser**

Run: `pnpm dev`

Navigate to the Claude Transcripts page. Verify:
- Project groups show with sessions
- Clicking a session opens the slide-over
- The "Project Work Summary" view shows the new ConversationRenderer:
  - Human messages have blue-tinted background with "You" badge
  - Assistant messages have gray-tinted background with "Claude" badge
  - Timestamps show on each message (when available)
  - Tool call chips appear collapsed below assistant messages
  - Clicking tool chips expands to show tool details
- The "Raw" toggle shows pretty-printed JSON
- The "Engineering Decisions" extractor (if triggered) still renders with ReactMarkdown
- The "Raw Transcript" view still works as before

- [ ] **Step 5: Commit any fixes if needed**

Review what changed, then stage only relevant files:

```bash
git status
git add <specific files that were fixed>
git commit -m "fix: address issues found during verification"
```
