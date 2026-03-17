"use node";

import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import { v } from "convex/values";

// ---------------------------------------------------------------------------
// Parser types
// ---------------------------------------------------------------------------

type ParseResult = {
  title: string;
  content: string;
  tags: string[];
  metadata: Record<string, unknown>;
};

type ParserFn = (rawText: string, projectPath?: string, projectName?: string) => ParseResult;

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
// deriveTitle — smart title from first meaningful human message
// ---------------------------------------------------------------------------

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

function deriveTitle(messages: Array<{ role: string; text: string }>): string {
  const MAX_TITLE_LENGTH = 120;

  let candidate = "";
  for (const msg of messages) {
    if (msg.role !== "human") continue;
    candidate = msg.text.trim();

    // Strip leading slash commands (e.g., /commit, /review-pr, /help)
    candidate = candidate.replace(/^\/\S+\s*/g, "").trim();

    // Strip common filler phrases at the start
    const fillers = /^(can you|could you|please|i want to|i need to|i'd like to|let's|lets)\s+/i;
    while (fillers.test(candidate)) {
      candidate = candidate.replace(fillers, "").trim();
    }

    if (candidate.length >= 10) break;
  }

  if (!candidate || candidate.length < 10) {
    return "Claude Code conversation";
  }

  // Collapse whitespace and newlines
  candidate = candidate.replace(/\n/g, " ").replace(/\s+/g, " ").trim();

  // Truncate at first sentence boundary if within max length
  const sentenceEnd = candidate.search(/[.?!]\s/);
  if (sentenceEnd > 0 && sentenceEnd < MAX_TITLE_LENGTH) {
    candidate = candidate.slice(0, sentenceEnd + 1);
  } else if (candidate.length > MAX_TITLE_LENGTH) {
    candidate = candidate.slice(0, MAX_TITLE_LENGTH - 3) + "...";
  }

  // Capitalize first letter
  candidate = candidate.charAt(0).toUpperCase() + candidate.slice(1);

  return candidate;
}

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

// ---------------------------------------------------------------------------
// parseClaudeStripTools
// Parses JSONL Claude conversation transcripts, stripping tool calls.
// ---------------------------------------------------------------------------

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

    // Extract content — can be a string (user messages) or array of blocks (assistant messages)
    const messageContent = record.message as { content?: unknown } | undefined;
    if (!messageContent) continue;

    let contentArr: Array<Record<string, unknown>> = [];
    let directText: string | null = null;

    if (typeof messageContent.content === "string") {
      // User messages often have content as a plain string
      directText = messageContent.content;
    } else if (Array.isArray(messageContent.content)) {
      contentArr = messageContent.content as Array<Record<string, unknown>>;
    }

    const textParts: string[] = [];
    const toolCalls: ToolCallSummary[] = [];

    if (directText) {
      textParts.push(directText);
    }

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

  // Build tags from projectName
  const tags: string[] = [];
  if (projectName) tags.push(projectName);

  return {
    title,
    content,
    tags,
    metadata: {
      messageCount: truncatedMessages.length,
      parser: "claude-strip-tools",
      format: "conversation-json",
      ...(projectPath ? { projectPath } : {}),
      ...(projectName ? { projectName } : {}),
    },
  };
}

// ---------------------------------------------------------------------------
// Parser registry
// ---------------------------------------------------------------------------

const PARSERS: Record<string, ParserFn> = {
  "claude-strip-tools": parseClaudeStripTools,
};

// ---------------------------------------------------------------------------
// runExtractor internalAction
// ---------------------------------------------------------------------------

export const runExtractor = internalAction({
  args: {
    rawFileId: v.id("rawFiles"),
    extractorName: v.string(),
  },
  returns: v.object({ entryCount: v.number() }),
  handler: async (ctx, { rawFileId, extractorName }) => {
    // 1. Fetch rawFile record
    const rawFile = await ctx.runQuery(internal.rawFiles.getById, {
      id: rawFileId,
    });
    if (!rawFile) {
      throw new Error(`rawFile not found: ${rawFileId}`);
    }

    // 2. Fetch extractor config
    const extractor = await ctx.runQuery(
      internal.extractors.getBySourceNameInternal,
      { source: rawFile.source, name: extractorName }
    );
    if (!extractor) {
      throw new Error(
        `Extractor not found: source=${rawFile.source} name=${extractorName}`
      );
    }

    // 3. Fetch raw file bytes from storage
    if (!rawFile.storageId) {
      throw new Error(`Raw file ${rawFileId} has no storage file (may be a zero-message marker)`);
    }
    const blob = await ctx.storage.get(rawFile.storageId);
    if (!blob) {
      throw new Error(`Storage object not found: ${rawFile.storageId}`);
    }
    const rawText = await blob.text();

    // 4. Dispatch by extractor type
    if (extractor.type === "mechanical") {
      const parserName: string = extractor.parserName ?? extractorName;
      const parser = PARSERS[parserName];
      if (!parser) {
        throw new Error(`No parser registered for parserName: ${parserName}`);
      }

      const parsed = parser(rawText, rawFile.projectPath, rawFile.projectName);

      // Build a stable sourceId for the knowledge entry
      // Use rawFile.sourceId + extractor name so re-runs upsert, not duplicate
      const sourceId = `${rawFile.sourceId}::${extractorName}`;

      await ctx.runMutation(internal.knowledgeEntries.upsertFromExtractor, {
        source: rawFile.source,
        sourceId,
        title: parsed.title,
        content: parsed.content,
        tags: parsed.tags.length > 0 ? parsed.tags : undefined,
        timestamp: rawFile.timestamp,
        metadata: parsed.metadata,
        rawFileId,
        extractorName,
      });

      return { entryCount: 1 };
    }

    if (extractor.type === "ai" && extractor.promptTemplate) {
      const Anthropic = (await import("@anthropic-ai/sdk")).default;
      const anthropic = new Anthropic();

      // Use mechanical parser to get structured conversation, then convert to readable text for AI
      const cleanParser = PARSERS["claude-strip-tools"];
      const parsed = cleanParser(rawText);
      const readableText = messagesToReadableText(
        JSON.parse(parsed.content) as ConversationMessage[]
      );

      // Substitute template variables
      let prompt = extractor.promptTemplate;
      prompt = prompt.replace(/\{\{content\}\}/g, readableText.slice(0, 30_000));
      prompt = prompt.replace(/\{\{projectName\}\}/g, rawFile.projectName ?? "unknown");

      const response = await anthropic.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 4096,
        messages: [{ role: "user", content: prompt }],
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
      let entryCount = 0;
      for (let i = 0; i < decisions.length; i++) {
        const decision = decisions[i];
        await ctx.runMutation(internal.knowledgeEntries.upsertFromExtractor, {
          source: rawFile.source,
          sourceId: `${rawFile.sourceId}:${extractorName}:${i}`,
          title: decision.title,
          content: decision.content,
          tags: [...(decision.tags ?? []), "engineering-decision", rawFile.projectName ?? ""].filter(Boolean),
          timestamp: rawFile.timestamp,
          metadata: { projectPath: rawFile.projectPath, extractedFrom: rawFile.sourceId },
          rawFileId,
          extractorName,
        });
        entryCount++;
      }

      return { entryCount };
    }

    throw new Error(`Unknown extractor type: ${extractor.type}`);
  },
});
