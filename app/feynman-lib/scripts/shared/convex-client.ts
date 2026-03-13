import { ConvexHttpClient } from "convex/browser";
import type { KnowledgeEntryInput } from "./types.js";

export function createConvexClient(): ConvexHttpClient {
  const url = process.env.CONVEX_URL;
  if (!url) {
    throw new Error(
      "CONVEX_URL environment variable is required. " +
      "Set it to your Convex deployment URL (e.g., https://your-project-123.convex.cloud)"
    );
  }
  return new ConvexHttpClient(url);
}

export async function upsertKnowledgeEntry(
  client: ConvexHttpClient,
  entry: KnowledgeEntryInput
): Promise<string> {
  const result = await client.mutation(
    "knowledgeEntries:upsert" as any,
    entry
  );
  return result as string;
}

export async function updateSourceLastIngested(
  client: ConvexHttpClient,
  sourceType: string,
  entryCount?: number
): Promise<void> {
  await client.mutation("sources:updateLastIngested" as any, {
    type: sourceType,
    lastIngestedAt: Date.now(),
    entryCount,
  });
}
