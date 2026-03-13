/**
 * Weekly Digest Generation Script
 *
 * Queries recent knowledge entries from Convex, calls the Claude API to
 * generate a structured weekly digest, and stores the result back in Convex.
 *
 * Usage:
 *   npm run digest:generate
 *   npm run digest:generate -- 14    # custom days back
 *
 * Requires CONVEX_URL and ANTHROPIC_API_KEY in app/feynman-lib/.env
 */

import "./shared/env.js";
import Anthropic from "@anthropic-ai/sdk";
import { createConvexClient } from "./shared/convex-client.js";
import type { DigestInput, KnowledgeEntryInput } from "./shared/types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DigestResponse {
  activitySummary: string;
  keyThemes: string[];
  contentIdeas: {
    title: string;
    format: string;
    reasoning: string;
  }[];
  knowledgeGaps: string[];
  notableSaves: string[];
  rawMarkdown: string;
}

interface KnowledgeEntry extends KnowledgeEntryInput {
  _id?: string;
  _creationTime?: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_DAYS_BACK = 7;
const MAX_CONTENT_PER_ENTRY = 2000;
const MAX_ENTRIES_PER_SOURCE = 50;
const CLAUDE_MODEL = "claude-sonnet-4-20250514";
const MAX_TOKENS = 4096;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + "...";
}

function groupBySource(
  entries: KnowledgeEntry[]
): Record<string, KnowledgeEntry[]> {
  const groups: Record<string, KnowledgeEntry[]> = {};
  for (const entry of entries) {
    const source = entry.source;
    if (!groups[source]) {
      groups[source] = [];
    }
    groups[source].push(entry);
  }
  return groups;
}

function formatEntriesForPrompt(entries: KnowledgeEntry[]): string {
  const grouped = groupBySource(entries);
  const parts: string[] = [];

  for (const [source, sourceEntries] of Object.entries(grouped)) {
    const capped = sourceEntries.slice(0, MAX_ENTRIES_PER_SOURCE);
    parts.push(`## Source: ${source} (${capped.length} entries)`);
    parts.push("");

    for (const entry of capped) {
      parts.push(`### ${entry.title}`);
      if (entry.url) {
        parts.push(`URL: ${entry.url}`);
      }
      parts.push(
        `Timestamp: ${new Date(entry.timestamp).toISOString()}`
      );
      if (entry.tags && entry.tags.length > 0) {
        parts.push(`Tags: ${entry.tags.join(", ")}`);
      }
      parts.push("");
      parts.push(truncate(entry.content, MAX_CONTENT_PER_ENTRY));
      parts.push("");
      parts.push("---");
      parts.push("");
    }
  }

  return parts.join("\n");
}

function buildSystemPrompt(): string {
  return `You are a personal content strategist and knowledge synthesizer for a builder who creates authentic content based on their real work.

Your job is to analyze recent knowledge entries — code conversations, git commits, bookmarks, notes — and produce a structured weekly digest that:

1. Summarizes what was actually worked on (not generic fluff)
2. Identifies recurring themes and patterns across the work
3. Suggests specific content ideas grounded in what was done — not generic content marketing advice
4. Points out knowledge gaps that could be explored further
5. Highlights notable saves or references worth revisiting

Philosophy:
- "Building in public" — sharing learnings, process, and honest reflections
- Authenticity over polish — real experiences resonate more than manufactured content
- Content should emerge naturally from the work, not be forced
- Match format to content: complex technical deep-dives → blog posts or talking-head videos, fun experiments → AI-animated videos, quick insights → twitter threads, professional reflections → LinkedIn posts

Respond with ONLY a valid JSON object (no markdown code fences, no extra text) matching this exact structure:

{
  "activitySummary": "2-3 paragraphs summarizing what was worked on",
  "keyThemes": ["3-5 recurring topics or themes"],
  "contentIdeas": [
    {
      "title": "Catchy, specific title for the content piece",
      "format": "talking-head | ai-video | blog | twitter-thread | linkedin-post",
      "reasoning": "Why this would resonate and what makes it authentic"
    }
  ],
  "knowledgeGaps": ["2-3 areas explored but not fully resolved"],
  "notableSaves": ["Interesting bookmarks or references worth highlighting"],
  "rawMarkdown": "Full digest formatted as readable markdown"
}`;
}

function buildUserPrompt(entries: KnowledgeEntry[], daysBack: number): string {
  const formatted = formatEntriesForPrompt(entries);
  const sources = Object.keys(groupBySource(entries));

  return `Here are my knowledge entries from the past ${daysBack} days, across ${sources.length} source(s): ${sources.join(", ")}.

Total entries: ${entries.length}

Please analyze these and generate my weekly digest.

---

${formatted}`;
}

/**
 * Attempt to extract a JSON object from text that might contain markdown
 * code fences or other surrounding text.
 */
function extractJson(text: string): string {
  // Try to find JSON within code fences
  const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fenceMatch) {
    return fenceMatch[1].trim();
  }

  // Try to find a JSON object directly
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    return jsonMatch[0];
  }

  return text;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  // Parse CLI arg for days back
  const daysBack = parseInt(process.argv[2] ?? "", 10) || DEFAULT_DAYS_BACK;

  console.log(`\u{1F4CA} Generating digest for the past ${daysBack} days...\n`);

  // Validate environment
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error(
      "Error: ANTHROPIC_API_KEY environment variable is required."
    );
    process.exit(1);
  }

  // Query Convex for recent entries
  const client = createConvexClient();
  const since = Date.now() - daysBack * 24 * 60 * 60 * 1000;

  const entries = (await client.query("knowledgeEntries:getRecent" as any, {
    since,
  })) as KnowledgeEntry[];

  if (!entries || entries.length === 0) {
    console.log(
      `No knowledge entries found in the past ${daysBack} days.\n` +
        "Try a longer time range: tsx scripts/generate-digest.ts 14"
    );
    process.exit(0);
  }

  const sources = Object.keys(groupBySource(entries));
  console.log(
    `Found ${entries.length} entries across sources: ${sources.join(", ")}\n`
  );
  console.log("Calling Claude API...\n");

  // Call Claude API
  const anthropic = new Anthropic();

  const message = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: MAX_TOKENS,
    system: buildSystemPrompt(),
    messages: [
      {
        role: "user",
        content: buildUserPrompt(entries, daysBack),
      },
    ],
  });

  // Extract text response
  const textBlock = message.content.find((block) => block.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    console.error("Error: No text response from Claude API.");
    process.exit(1);
  }

  const responseText = textBlock.text;

  // Parse JSON response
  let digest: DigestResponse;
  try {
    digest = JSON.parse(responseText) as DigestResponse;
  } catch {
    // Try extracting JSON from the response
    try {
      const extracted = extractJson(responseText);
      digest = JSON.parse(extracted) as DigestResponse;
    } catch (innerErr) {
      console.error("Error: Failed to parse Claude response as JSON.");
      console.error(
        "Raw response:\n",
        responseText.slice(0, 500)
      );
      process.exit(1);
    }
  }

  // Store digest in Convex
  const now = Date.now();
  const digestInput: DigestInput = {
    startDate: since,
    endDate: now,
    activitySummary: digest.activitySummary,
    keyThemes: digest.keyThemes,
    contentIdeas: digest.contentIdeas,
    knowledgeGaps: digest.knowledgeGaps,
    notableSaves: digest.notableSaves,
    rawMarkdown: digest.rawMarkdown,
  };

  await client.mutation("digests:create" as any, digestInput);

  console.log("\u2705 Digest generated and stored!\n");
  console.log("--- Digest Preview ---\n");
  console.log(digest.rawMarkdown);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
