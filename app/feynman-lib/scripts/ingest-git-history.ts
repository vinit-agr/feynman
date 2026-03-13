/**
 * Git History Ingestion Script
 *
 * Reads git commit history from specified repositories and pushes them
 * as knowledge entries to Convex.
 *
 * Usage:
 *   npm run ingest:git -- ~/repo1 ~/repo2
 *   npm run ingest:git -- --since="60 days ago" ~/repo1
 *
 * Requires CONVEX_URL in app/feynman-lib/.env
 */

import "./shared/env.js";
import * as path from "node:path";
import * as fs from "node:fs";
import { execSync } from "node:child_process";
import {
  createConvexClient,
  upsertKnowledgeEntry,
  updateSourceLastIngested,
} from "./shared/convex-client.js";
import type { KnowledgeEntryInput, IngestResult } from "./shared/types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SOURCE_NAME = "git-commit";
const MAX_STAT_LENGTH = 5000;
const MAX_TITLE_LENGTH = 100;
const DEFAULT_SINCE = "30 days ago";
const GIT_LOG_MAX_BUFFER = 10 * 1024 * 1024; // 10MB

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GitCommit {
  hash: string;
  author: string;
  date: string; // ISO 8601
  message: string;
  stat: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse CLI arguments to extract --since flag and repo paths.
 */
function parseArgs(args: string[]): { since: string; repoPaths: string[] } {
  let since = DEFAULT_SINCE;
  const repoPaths: string[] = [];

  for (const arg of args) {
    if (arg.startsWith("--since=")) {
      since = arg.slice("--since=".length).replace(/^["']|["']$/g, "");
    } else {
      repoPaths.push(arg);
    }
  }

  return { since, repoPaths };
}

/**
 * Check if a path is a valid git repository.
 */
function isGitRepo(repoPath: string): boolean {
  if (!fs.existsSync(repoPath)) return false;
  try {
    execSync("git rev-parse --is-inside-work-tree", {
      cwd: repoPath,
      stdio: "pipe",
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get commits from a git repository since a given date.
 * Uses a NUL-delimited format to reliably parse multi-line commit messages.
 */
function getCommits(repoPath: string, since: string): GitCommit[] {
  // Use %x00 (NUL) as delimiter between fields and %x01 (SOH) between records
  const format = "%H%x00%an%x00%aI%x00%B%x00";
  const logOutput = execSync(
    `git log --no-merges --since="${since}" --format="${format}"`,
    {
      cwd: repoPath,
      maxBuffer: GIT_LOG_MAX_BUFFER,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }
  );

  if (!logOutput.trim()) return [];

  // Each commit ends with a NUL + newline. Split on double-newline after NUL.
  const rawCommits = logOutput.split("\0\n").filter((s) => s.trim());

  const commits: GitCommit[] = [];

  for (const raw of rawCommits) {
    const parts = raw.split("\0");
    if (parts.length < 4) continue;

    const hash = parts[0].trim();
    const author = parts[1];
    const date = parts[2];
    const message = parts[3].trim();

    if (!hash) continue;

    // Get stat for this specific commit
    let stat = "";
    try {
      stat = execSync(`git diff-tree --stat --no-commit-id ${hash}`, {
        cwd: repoPath,
        maxBuffer: GIT_LOG_MAX_BUFFER,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      }).trim();
    } catch {
      // Non-fatal — stat is optional
    }

    // Cap stat length
    if (stat.length > MAX_STAT_LENGTH) {
      stat = stat.slice(0, MAX_STAT_LENGTH) + "\n[stat truncated]";
    }

    commits.push({ hash, author, date, message, stat });
  }

  return commits;
}

/**
 * Format a commit as a markdown knowledge entry content block.
 */
function formatCommitContent(commit: GitCommit, repoName: string): string {
  const lines: string[] = [
    `## Commit \`${commit.hash.slice(0, 8)}\``,
    "",
    `**Repository:** ${repoName}`,
    `**Author:** ${commit.author}`,
    `**Date:** ${commit.date}`,
    "",
    "### Message",
    "",
    commit.message,
  ];

  if (commit.stat) {
    lines.push("", "### Files Changed", "", "```", commit.stat, "```");
  }

  return lines.join("\n");
}

/**
 * Build the title for a commit entry.
 */
function buildTitle(repoName: string, message: string): string {
  const firstLine = message.split("\n")[0].trim();
  const raw = `[${repoName}] ${firstLine}`;
  if (raw.length > MAX_TITLE_LENGTH) {
    return raw.slice(0, MAX_TITLE_LENGTH - 3) + "...";
  }
  return raw;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const { since, repoPaths } = parseArgs(args);

  if (repoPaths.length === 0) {
    console.log("Usage: tsx scripts/ingest-git-history.ts [--since=\"N days ago\"] <repo1> [repo2] ...");
    console.log("");
    console.log("Examples:");
    console.log("  CONVEX_URL=<url> tsx scripts/ingest-git-history.ts ~/repo1 ~/repo2");
    console.log("  CONVEX_URL=<url> tsx scripts/ingest-git-history.ts --since=\"60 days ago\" ~/repo1");
    process.exit(1);
  }

  const client = createConvexClient();
  const result: IngestResult = {
    source: SOURCE_NAME,
    entriesProcessed: 0,
    entriesCreated: 0,
    entriesSkipped: 0,
    errors: [],
  };

  for (const rawPath of repoPaths) {
    const repoPath = path.resolve(rawPath);
    const repoName = path.basename(repoPath);

    console.log(`\n\u{1F4C2} Scanning ${rawPath}...`);

    if (!isGitRepo(repoPath)) {
      console.error(`  \u2717 Not a git repository or does not exist: ${rawPath}`);
      result.errors.push(`${rawPath}: not a git repository or does not exist`);
      continue;
    }

    let commits: GitCommit[];
    try {
      commits = getCommits(repoPath, since);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(`  \u2717 Failed to read git log: ${errorMsg}`);
      result.errors.push(`${repoName}: ${errorMsg}`);
      continue;
    }

    console.log(`  Found ${commits.length} commits`);

    for (const commit of commits) {
      result.entriesProcessed++;

      try {
        const title = buildTitle(repoName, commit.message);
        const content = formatCommitContent(commit, repoName);
        const sourceId = `${repoName}:${commit.hash}`;
        const timestamp = new Date(commit.date).getTime();

        const entry: KnowledgeEntryInput = {
          source: SOURCE_NAME,
          sourceId,
          title,
          content,
          timestamp,
          metadata: {
            repo: repoName,
            hash: commit.hash,
            author: commit.author,
          },
        };

        await upsertKnowledgeEntry(client, entry);
        result.entriesCreated++;

        const displayTitle = title.length > 80 ? title.slice(0, 77) + "..." : title;
        console.log(`  \u2713 ${displayTitle}`);
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        result.errors.push(`${repoName}:${commit.hash.slice(0, 8)}: ${errorMsg}`);
        result.entriesSkipped++;
        console.error(`  \u2717 ${repoName}:${commit.hash.slice(0, 8)}: ${errorMsg}`);
      }
    }
  }

  // Update source tracking
  try {
    await updateSourceLastIngested(client, SOURCE_NAME, result.entriesCreated);
  } catch {
    // Non-fatal — source tracking is optional
  }

  // Print summary
  console.log("\n--- Git Ingestion Complete ---");
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
