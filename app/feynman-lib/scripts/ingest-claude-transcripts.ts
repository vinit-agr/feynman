/**
 * Claude Code Transcripts Upload Script
 *
 * Scans ~/.claude/ JSONL transcript files and uploads them as raw files
 * to Convex file storage. Server-side extractors handle parsing.
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
import {
  createConvexClient,
  updateSourceLastIngested,
  generateUploadUrl,
  getRawFileBySourceId,
  createRawFile,
  reuploadRawFile,
  findOrCreateProject,
} from "./shared/convex-client.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CLAUDE_DIR = path.join(os.homedir(), ".claude");
const PROJECTS_DIR = path.join(CLAUDE_DIR, "projects");
const SOURCE_NAME = "claude-transcripts";

// ---------------------------------------------------------------------------
// File discovery
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Metadata derivation (no JSONL parsing)
// ---------------------------------------------------------------------------

/**
 * Derive sourceId from filename: "claude:{basename without .jsonl}"
 */
function deriveSourceId(filePath: string): string {
  const basename = path.basename(filePath, ".jsonl");
  return `claude:${basename}`;
}

/**
 * Derive sessionId from the UUID directory name or filename.
 * Claude transcript filenames are typically UUIDs.
 */
function deriveSessionId(filePath: string): string {
  return path.basename(filePath, ".jsonl");
}

/**
 * Derive the project path from the directory structure.
 * e.g. ~/.claude/projects/-Users-vinit-Tars-feynman/ -> /Users/vinit/Tars/feynman
 */
function deriveProjectPath(filePath: string): string | undefined {
  const relative = path.relative(PROJECTS_DIR, filePath);
  const parts = relative.split(path.sep);
  if (parts.length < 2) return undefined;

  const projectDir = parts[0];
  if (!projectDir || projectDir === "..") return undefined;

  // Convert -Users-vinit-Tars-Development-foo to /Users/vinit/Tars/Development/foo
  // The dir names encode absolute paths with dashes replacing slashes
  // Leading dash means it started with a slash
  if (projectDir.startsWith("-")) {
    return projectDir.replace(/-/g, "/");
  }
  return projectDir;
}

/**
 * Derive the project name (last path segment of project path).
 */
function deriveProjectName(projectPath: string | undefined): string | undefined {
  if (!projectPath) return undefined;
  return path.basename(projectPath) || undefined;
}

// ---------------------------------------------------------------------------
// Upload helpers
// ---------------------------------------------------------------------------

async function uploadFile(uploadUrl: string, fileContent: Buffer): Promise<string> {
  const response = await fetch(uploadUrl, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: fileContent,
  });

  if (!response.ok) {
    throw new Error(`Upload failed: ${response.status} ${response.statusText}`);
  }

  const data = await response.json() as { storageId: string };
  return data.storageId;
}

// ---------------------------------------------------------------------------
// Message counting
// ---------------------------------------------------------------------------

async function countMessages(filePath: string): Promise<number> {
  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split("\n").filter((l) => l.trim());
  let messageCount = 0;
  for (const line of lines) {
    try {
      const record = JSON.parse(line);
      if (record.type === "human" || record.type === "assistant") {
        messageCount++;
      }
    } catch {
      // skip unparseable lines
    }
  }
  return messageCount;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("Scanning for Claude Code transcripts...\n");

  // Collect all JSONL files
  const files: string[] = [];

  // 1. Scan ~/.claude/projects/ recursively
  if (fs.existsSync(PROJECTS_DIR)) {
    files.push(...findJsonlFiles(PROJECTS_DIR));
  }

  // 2. Check ~/.claude/ root for JSONL files (skip history.jsonl)
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

  let newUploads = 0;
  let reUploads = 0;
  let skipped = 0;
  let errors = 0;

  for (const filePath of files) {
    const fileName = path.basename(filePath);

    try {
      const stat = fs.statSync(filePath);
      const localFileSize = stat.size;
      const localModifiedAt = Math.floor(stat.mtimeMs);
      const timestamp = localModifiedAt;

      const sourceId = deriveSourceId(filePath);
      const existing = await getRawFileBySourceId(client, SOURCE_NAME, sourceId);

      if (existing) {
        // Skip deleted files entirely
        if (existing.deleted === true) {
          skipped++;
          continue;
        }

        // Check if size and mtime match — if so, skip
        if (
          existing.localFileSize === localFileSize &&
          existing.localModifiedAt === localModifiedAt
        ) {
          skipped++;
          continue;
        }

        // File changed — re-upload (do NOT touch projectId)
        const fileContent = fs.readFileSync(filePath);
        const uploadUrl = await generateUploadUrl(client);
        const storageId = await uploadFile(uploadUrl, fileContent);

        await reuploadRawFile(client, {
          id: existing._id,
          storageId,
          localFileSize,
          localModifiedAt,
          timestamp,
        });

        reUploads++;
        console.log(`  re-uploaded: ${fileName}`);
      } else {
        // New file — check message count first
        const messageCount = await countMessages(filePath);

        if (messageCount === 0) {
          // Zero-message file — create marker row, no storage upload
          const projectPath = deriveProjectPath(filePath);
          const projectName = deriveProjectName(projectPath);
          const sessionId = deriveSessionId(filePath);

          await createRawFile(client, {
            source: SOURCE_NAME,
            sourceId,
            projectPath,
            projectName,
            sessionId,
            fileName,
            localFileSize,
            localModifiedAt,
            timestamp,
            deleted: true,
          });

          skipped++;
          console.log(`  skipped (empty): ${fileName}`);
          continue;
        }

        // Has messages — upload and create record with project
        const projectPath = deriveProjectPath(filePath);
        const projectName = deriveProjectName(projectPath);
        const sessionId = deriveSessionId(filePath);

        // Find or create project group
        let projectId: string | undefined;
        if (projectName) {
          projectId = await findOrCreateProject(client, projectName, SOURCE_NAME);
        }

        const fileContent = fs.readFileSync(filePath);
        const uploadUrl = await generateUploadUrl(client);
        const storageId = await uploadFile(uploadUrl, fileContent);

        await createRawFile(client, {
          source: SOURCE_NAME,
          sourceId,
          storageId,
          projectPath,
          projectName,
          sessionId,
          fileName,
          localFileSize,
          localModifiedAt,
          timestamp,
          projectId,
          deleted: false,
        });

        newUploads++;
        console.log(`  uploaded: ${fileName}`);
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      errors++;
      console.error(`  error [${fileName}]: ${errorMsg}`);
    }
  }

  // Update source tracking
  try {
    await updateSourceLastIngested(client, SOURCE_NAME, newUploads + reUploads);
  } catch {
    // Non-fatal — source tracking is optional
  }

  // Print summary
  console.log("\n--- Upload Complete ---");
  console.log(`New uploads:  ${newUploads}`);
  console.log(`Re-uploads:   ${reUploads}`);
  console.log(`Skipped:      ${skipped}`);
  console.log(`Errors:       ${errors}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
