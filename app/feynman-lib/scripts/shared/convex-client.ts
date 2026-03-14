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

export async function generateUploadUrl(client: ConvexHttpClient): Promise<string> {
  return await client.mutation("rawFiles:generateUploadUrl" as any, {});
}

export async function getRawFileBySourceId(client: ConvexHttpClient, source: string, sourceId: string): Promise<any> {
  return await client.query("rawFiles:getBySourceId" as any, { source, sourceId });
}

export async function createRawFile(client: ConvexHttpClient, args: {
  source: string; sourceId: string; storageId?: string;
  projectPath?: string; projectName?: string; sessionId?: string;
  fileName: string; localFileSize: number; localModifiedAt: number; timestamp: number;
  projectId?: string; deleted?: boolean;
}): Promise<string> {
  return await client.mutation("rawFiles:create" as any, args);
}

export async function findOrCreateProject(client: ConvexHttpClient, name: string, source: string): Promise<string> {
  return await client.mutation("projects:findOrCreate" as any, { name, source });
}

export async function reuploadRawFile(client: ConvexHttpClient, args: {
  id: string; storageId: string; localFileSize: number; localModifiedAt: number; timestamp: number;
}): Promise<void> {
  await client.mutation("rawFiles:reupload" as any, args);
}
