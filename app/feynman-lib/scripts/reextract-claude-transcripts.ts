/**
 * Claude Transcripts Re-extraction Script
 *
 * Re-triggers extraction on all non-deleted Claude transcript rawFiles.
 * Useful after changing parser logic — no cleanup or re-ingestion needed.
 *
 * Usage:
 *   pnpm reextract:claude
 *
 * Requires CONVEX_URL in app/feynman-lib/.env
 */

import "./shared/env.js";
import { createConvexClient } from "./shared/convex-client.js";

const SOURCE_NAME = "claude-transcripts";

async function main(): Promise<void> {
  console.log("Re-extracting Claude transcript data...\n");

  const client = createConvexClient();

  // Get all non-deleted rawFiles for this source
  const rawFiles: any[] = await client.query("rawFiles:list" as any, {
    source: SOURCE_NAME,
    limit: 10000,
  });

  console.log(`Found ${rawFiles.length} raw files to re-extract\n`);

  let triggered = 0;
  let skipped = 0;
  let errors = 0;

  for (const rawFile of rawFiles) {
    // Skip files without storage (zero-message markers)
    if (!rawFile.storageId) {
      skipped++;
      continue;
    }

    try {
      // Trigger the auto-run extractor(s) for this file
      await client.mutation("rawFiles:triggerExtractor" as any, {
        rawFileId: rawFile._id,
        extractorName: "project-work-summary",
      });
      triggered++;
      console.log(`  triggered: ${rawFile.fileName}`);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      errors++;
      console.error(`  error [${rawFile.fileName}]: ${errorMsg}`);
    }
  }

  console.log("\n--- Re-extraction Complete ---");
  console.log(`Triggered:  ${triggered}`);
  console.log(`Skipped:    ${skipped} (no storage)`);
  console.log(`Errors:     ${errors}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
