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

// ---------------------------------------------------------------------------
// deriveTitle — smart title from first meaningful human message
// ---------------------------------------------------------------------------

function deriveTitle(messages: Array<{ role: string; text: string }>): string {
  const MAX_TITLE_LENGTH = 120;

  let candidate = "";
  for (const msg of messages) {
    if (msg.role !== "Human") continue;
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

// ---------------------------------------------------------------------------
// parseClaudeStripTools
// Parses JSONL Claude conversation transcripts, stripping tool calls.
// ---------------------------------------------------------------------------

function parseClaudeStripTools(rawText: string, projectPath?: string, projectName?: string): ParseResult {
  const lines = rawText.split("\n").filter((l) => l.trim().length > 0);

  const messages: Array<{ role: string; text: string }> = [];

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

    // Extract text content blocks only
    const messageContent = record.message as
      | { content?: unknown }
      | undefined;
    if (!messageContent) continue;

    const contentArr = Array.isArray(messageContent.content)
      ? (messageContent.content as Array<Record<string, unknown>>)
      : [];

    const textParts: string[] = [];
    for (const block of contentArr) {
      if (block.type === "text" && typeof block.text === "string") {
        textParts.push(block.text);
      }
      // Skip tool_use, tool_result blocks
    }

    if (textParts.length === 0) continue;

    const role = type === "user" ? "Human" : "Assistant";
    messages.push({ role, text: textParts.join("\n") });
  }

  // Derive title from first meaningful human message
  const title = deriveTitle(messages);

  // Build markdown content, optionally prefixed with project header
  const headerParts: string[] = [];
  if (projectName) headerParts.push(`**Project:** ${projectName}`);
  if (projectPath) headerParts.push(`**Path:** ${projectPath}`);
  const header = headerParts.length > 0 ? headerParts.join("  \n") + "\n\n" : "";

  const sections = messages.map(
    (m) => `### ${m.role}\n\n${m.text}`
  );
  let content = header + sections.join("\n\n---\n\n");

  // Cap at 50,000 chars
  if (content.length > 50_000) {
    content = content.slice(0, 50_000);
  }

  // Build tags from projectName/projectPath
  const tags: string[] = [];
  if (projectName) tags.push(projectName);

  return {
    title,
    content,
    tags,
    metadata: {
      messageCount: messages.length,
      parser: "claude-strip-tools",
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

      // Use mechanical parser to get clean conversation text
      const cleanParser = PARSERS["claude-strip-tools"];
      const parsed = cleanParser(rawText);

      // Substitute template variables
      let prompt = extractor.promptTemplate;
      prompt = prompt.replace(/\{\{content\}\}/g, parsed.content.slice(0, 30_000));
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
