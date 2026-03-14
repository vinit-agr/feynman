/**
 * Claude Transcripts Cleanup Script
 *
 * Wipes all Claude transcript data (rawFiles, knowledgeEntries, storage files)
 * while preserving project groups. Useful for fresh re-ingestion.
 *
 * Usage:
 *   pnpm cleanup:claude
 *
 * Requires CONVEX_URL in app/feynman-lib/.env
 */

import "./shared/env.js";
import { createConvexClient } from "./shared/convex-client.js";

const SOURCE_NAME = "claude-transcripts";

async function main(): Promise<void> {
  console.log("Cleaning up Claude transcript data...\n");

  const client = createConvexClient();

  // Step 1: Collect storageIds from rawFiles before deleting rows
  console.log("Collecting storage file references...");
  const rawFiles: any[] = await client.query("rawFiles:list" as any, {
    source: SOURCE_NAME,
    limit: 10000,
  });

  // Also get deleted files (list filters them out)
  const allRawFiles: any[] = await client.query("rawFiles:listAll" as any, {
    source: SOURCE_NAME,
  });

  const storageIds = allRawFiles
    .filter((f: any) => f.storageId)
    .map((f: any) => f.storageId as string);
  console.log(`  Found ${allRawFiles.length} raw files (${storageIds.length} with storage)`);

  // Step 2: Delete all knowledgeEntries for this source
  console.log("Deleting knowledge entries...");
  const deletedEntries = await client.mutation("knowledgeEntries:deleteBySource" as any, {
    source: SOURCE_NAME,
  });
  console.log(`  Deleted ${deletedEntries} knowledge entries`);

  // Step 3: Delete all rawFiles for this source
  console.log("Deleting raw file records...");
  const deletedFiles = await client.mutation("rawFiles:deleteBySource" as any, {
    source: SOURCE_NAME,
  });
  console.log(`  Deleted ${deletedFiles} raw file records`);

  // Step 4: Delete storage files
  console.log("Deleting storage files...");
  let deletedStorage = 0;
  for (const storageId of storageIds) {
    try {
      await client.mutation("rawFiles:deleteStorageFile" as any, { storageId });
      deletedStorage++;
    } catch {
      // Storage file may already be gone
    }
  }
  console.log(`  Deleted ${deletedStorage} storage files`);

  console.log("\n--- Cleanup Complete ---");
  console.log("Projects have been preserved.");
  console.log("Run 'pnpm ingest:claude' to re-ingest from scratch.");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
