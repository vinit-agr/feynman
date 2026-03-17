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
