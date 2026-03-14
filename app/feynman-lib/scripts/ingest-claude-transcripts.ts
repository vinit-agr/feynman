/**
 * Claude Code Transcripts Ingestion Script
 *
 * Reads Claude Code conversation transcripts from ~/.claude/ JSONL files
 * and pushes them as knowledge entries to Convex.
 *
 * Usage:
 *   pnpm ingest:claude
 *
 * Requires CONVEX_URL in app/feynman-lib/.env
 */

import "./shared/env.js";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as readline from "node:readline";
import {
  createConvexClient,
  upsertKnowledgeEntry,
  updateSourceLastIngested,
} from "./shared/convex-client.js";
import type { KnowledgeEntryInput, IngestResult } from "./shared/types.js";

// ---------------------------------------------------------------------------
// Types for Claude Code JSONL records
// ---------------------------------------------------------------------------

interface ClaudeContentBlock {
  type: string;
  text?: string;
}

interface ClaudeMessage {
  role: string;
  content: string | ClaudeContentBlock[];
}

interface ClaudeRecord {
  type?: string;
  message?: ClaudeMessage;
  timestamp?: string;
  sessionId?: string;
  isMeta?: boolean;
  cwd?: string;
  gitBranch?: string;
  version?: string;
  isSidechain?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CLAUDE_DIR = path.join(os.homedir(), ".claude");
const PROJECTS_DIR = path.join(CLAUDE_DIR, "projects");
const MAX_CONTENT_LENGTH = 50_000;
const MAX_TITLE_LENGTH = 120;
const SOURCE_NAME = "claude-transcripts";

/**
 * Recursively find all .jsonl files under a directory, skipping subagent dirs.
 */
function findJsonlFiles(dir: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // Skip subagents — they are sub-task fragments, not full conversations
      if (entry.name === "subagents") continue;
      results.push(...findJsonlFiles(full));
    } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      results.push(full);
    }
  }
  return results;
}

/**
 * Extract the text content from a Claude message content field.
 */
function extractText(content: string | ClaudeContentBlock[]): string {
  if (typeof content === "string") return content;
  return content
    .filter((block) => block.type === "text" && block.text)
    .map((block) => block.text!)
    .join("\n");
}

/**
 * Strip XML-like tags that Claude Code injects (e.g. <command-message>, <local-command-caveat>).
 */
function stripInternalTags(text: string): string {
  return text
    .replace(/<\/?(?:command-message|command-name|command-args|local-command-caveat|antml:[a-z_]+)[^>]*>/g, "")
    .trim();
}

/**
 * Parse a single JSONL file and extract conversation messages.
 */
async function parseTranscriptFile(
  filePath: string
): Promise<{
  messages: { role: string; text: string }[];
  firstTimestamp: string | null;
  sessionId: string | null;
  projectPath: string | null;
}> {
  const messages: { role: string; text: string }[] = [];
  let firstTimestamp: string | null = null;
  let sessionId: string | null = null;
  let projectPath: string | null = null;

  const fileStream = fs.createReadStream(filePath, { encoding: "utf-8" });
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  for await (const line of rl) {
    if (!line.trim()) continue;

    let record: ClaudeRecord;
    try {
      record = JSON.parse(line);
    } catch {
      // Skip malformed lines
      continue;
    }

    // Capture session metadata
    if (!sessionId && record.sessionId) {
      sessionId = record.sessionId;
    }
    if (!projectPath && record.cwd) {
      projectPath = record.cwd;
    }

    // We only care about user and assistant messages
    const type = record.type;
    if (type !== "user" && type !== "assistant") continue;

    // Skip meta messages (system injections like local-command-caveat wrappers)
    if (record.isMeta) continue;

    // Skip sidechain messages
    if (record.isSidechain) continue;

    const msg = record.message;
    if (!msg || !msg.content) continue;

    const text = extractText(msg.content);
    const cleaned = stripInternalTags(text);
    if (!cleaned) continue;

    // Capture first timestamp
    if (!firstTimestamp && record.timestamp) {
      firstTimestamp = record.timestamp;
    }

    const role = type === "user" ? "Human" : "Assistant";
    messages.push({ role, text: cleaned });
  }

  return { messages, firstTimestamp, sessionId, projectPath };
}

/**
 * Create a title from the first human message.
 */
function createTitle(messages: { role: string; text: string }[]): string {
  const firstHuman = messages.find((m) => m.role === "Human");
  if (!firstHuman) return "Claude Code conversation";

  // Clean up the text — remove newlines, collapse whitespace
  let title = firstHuman.text.replace(/\n/g, " ").replace(/\s+/g, " ").trim();

  if (title.length > MAX_TITLE_LENGTH) {
    title = title.slice(0, MAX_TITLE_LENGTH - 3) + "...";
  }
  return title;
}

/**
 * Format messages into a readable content string.
 */
function formatContent(
  messages: { role: string; text: string }[],
  projectPath: string | null
): string {
  const parts: string[] = [];

  if (projectPath) {
    parts.push(`Project: ${projectPath}\n`);
  }

  for (const msg of messages) {
    parts.push(`### ${msg.role}\n\n${msg.text}\n`);
  }

  let content = parts.join("\n---\n\n");
  if (content.length > MAX_CONTENT_LENGTH) {
    content = content.slice(0, MAX_CONTENT_LENGTH - 20) + "\n\n[truncated]";
  }
  return content;
}

/**
 * Derive a sourceId from the file path.
 * Uses the session UUID from the filename.
 */
function deriveSourceId(filePath: string): string {
  const basename = path.basename(filePath, ".jsonl");
  return `claude-transcript:${basename}`;
}

/**
 * Derive tags from the project directory path.
 */
function deriveTags(filePath: string, projectPath: string | null): string[] {
  const tags = ["claude-code", "conversation"];

  // Extract project name from the directory structure
  // e.g. ~/.claude/projects/-Users-vinit-Tars-Development-tars-chatbot/...
  const relative = path.relative(PROJECTS_DIR, filePath);
  const projectDir = relative.split(path.sep)[0];
  if (projectDir && projectDir !== "..") {
    // Convert -Users-vinit-Tars-Development-foo to just "foo" (last segment)
    const segments = projectDir.split("-").filter(Boolean);
    const projectName = segments[segments.length - 1];
    if (projectName) {
      tags.push(projectName);
    }
  }

  if (projectPath) {
    // Also extract from cwd, e.g. /Users/vinit/Tars/Development/exp/foo -> "foo"
    const cwdName = path.basename(projectPath);
    if (cwdName && !tags.includes(cwdName)) {
      tags.push(cwdName);
    }
  }

  return tags;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("🔍 Scanning for Claude Code transcripts...\n");

  // Collect all JSONL files
  const files: string[] = [];

  // 1. Scan ~/.claude/projects/ recursively
  if (fs.existsSync(PROJECTS_DIR)) {
    files.push(...findJsonlFiles(PROJECTS_DIR));
  }

  // 2. Check ~/.claude/ root for JSONL files (skip history.jsonl — it's command history, not conversations)
  if (fs.existsSync(CLAUDE_DIR)) {
    const rootEntries = fs.readdirSync(CLAUDE_DIR, { withFileTypes: true });
    for (const entry of rootEntries) {
      if (
        entry.isFile() &&
        entry.name.endsWith(".jsonl") &&
        entry.name !== "history.jsonl"
      ) {
        files.push(path.join(CLAUDE_DIR, entry.name));
      }
    }
  }

  if (files.length === 0) {
    console.log("No transcript files found.");
    return;
  }

  console.log(`Found ${files.length} transcript files\n`);

  const client = createConvexClient();
  const result: IngestResult = {
    source: SOURCE_NAME,
    entriesProcessed: 0,
    entriesCreated: 0,
    entriesSkipped: 0,
    errors: [],
  };

  for (const filePath of files) {
    result.entriesProcessed++;

    try {
      const { messages, firstTimestamp, sessionId, projectPath } =
        await parseTranscriptFile(filePath);

      // Skip files with very few real messages (likely empty or just system messages)
      if (messages.length < 2) {
        result.entriesSkipped++;
        continue;
      }

      const title = createTitle(messages);
      const content = formatContent(messages, projectPath);
      const sourceId = deriveSourceId(filePath);
      const tags = deriveTags(filePath, projectPath);

      // Determine timestamp
      let timestamp: number;
      if (firstTimestamp) {
        timestamp = new Date(firstTimestamp).getTime();
      } else {
        // Fall back to file modification time
        const stat = fs.statSync(filePath);
        timestamp = stat.mtimeMs;
      }

      const entry: KnowledgeEntryInput = {
        source: SOURCE_NAME,
        sourceId,
        title,
        content,
        tags,
        timestamp,
        metadata: {
          sessionId: sessionId ?? undefined,
          projectPath: projectPath ?? undefined,
          messageCount: messages.length,
          filePath,
        },
      };

      await upsertKnowledgeEntry(client, entry);
      result.entriesCreated++;

      // Truncate title for display
      const displayTitle =
        title.length > 80 ? title.slice(0, 77) + "..." : title;
      console.log(`  ✓ ${displayTitle}`);
    } catch (err) {
      const errorMsg =
        err instanceof Error ? err.message : String(err);
      result.errors.push(`${path.basename(filePath)}: ${errorMsg}`);
      console.error(`  ✗ ${path.basename(filePath)}: ${errorMsg}`);
    }
  }

  // Update source tracking
  try {
    await updateSourceLastIngested(client, SOURCE_NAME, result.entriesCreated);
  } catch {
    // Non-fatal — source tracking is optional
  }

  // Print summary
  console.log("\n--- Ingestion Complete ---");
  console.log(`Processed: ${result.entriesProcessed}`);
  console.log(`Created/Updated: ${result.entriesCreated}`);
  console.log(`Skipped: ${result.entriesSkipped}`);
  if (result.errors.length > 0) {
    console.log(`Errors: ${result.errors.length}`);
    for (const err of result.errors) {
      console.log(`  - ${err}`);
    }
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
