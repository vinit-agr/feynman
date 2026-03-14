import { v } from "convex/values";
import { query, mutation, internalMutation, internalQuery } from "./_generated/server";

// NOTE: extractionPool and handleExtractionComplete come from ./extractionPool (Task 6).
// These imports will compile once that file exists.
import { extractionPool, handleExtractionComplete } from "./extractionPool";
import { internal } from "./_generated/api";

export const getBySourceId = query({
  args: {
    source: v.string(),
    sourceId: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    return await ctx.db
      .query("rawFiles")
      .withIndex("by_source_sourceId", (q) =>
        q.eq("source", args.source).eq("sourceId", args.sourceId)
      )
      .unique();
  },
});

export const list = query({
  args: {
    source: v.string(),
    limit: v.optional(v.number()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const limit = args.limit ?? 50;
    return await ctx.db
      .query("rawFiles")
      .withIndex("by_source_timestamp", (q) => q.eq("source", args.source))
      .order("desc")
      .take(limit);
  },
});

export const create = mutation({
  args: {
    source: v.string(),
    sourceId: v.string(),
    storageId: v.id("_storage"),
    projectPath: v.optional(v.string()),
    projectName: v.optional(v.string()),
    sessionId: v.optional(v.string()),
    fileName: v.string(),
    localFileSize: v.number(),
    localModifiedAt: v.number(),
    timestamp: v.number(),
  },
  returns: v.id("rawFiles"),
  handler: async (ctx, args) => {
    return await ctx.db.insert("rawFiles", {
      ...args,
      status: "uploaded" as const,
      extractionResults: [],
    });
  },
});

export const reupload = mutation({
  args: {
    id: v.id("rawFiles"),
    storageId: v.id("_storage"),
    localFileSize: v.number(),
    localModifiedAt: v.number(),
    timestamp: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { id, ...rest } = args;
    await ctx.db.patch(id, {
      ...rest,
      status: "uploaded" as const,
      extractionResults: [],
    });
    return null;
  },
});

export const updateExtractionResult = internalMutation({
  args: {
    rawFileId: v.id("rawFiles"),
    extractorName: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("running"),
      v.literal("completed"),
      v.literal("failed")
    ),
    entryCount: v.number(),
    error: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const rawFile = await ctx.db.get(args.rawFileId);
    if (!rawFile) throw new Error("Raw file not found");

    const results = [...(rawFile.extractionResults ?? [])];
    const existingIdx = results.findIndex((r) => r.extractorName === args.extractorName);
    const updatedResult = {
      extractorName: args.extractorName,
      status: args.status,
      entryCount: args.entryCount,
      error: args.error,
    };

    if (existingIdx === -1) {
      results.push(updatedResult);
    } else {
      results[existingIdx] = updatedResult;
    }

    // Check if all results are terminal (completed or failed) to transition overall status
    const allDone = results.every(
      (r) => r.status === "completed" || r.status === "failed"
    );
    const anyFailed = results.some((r) => r.status === "failed");
    const overallStatus = allDone
      ? anyFailed
        ? ("failed" as const)
        : ("extracted" as const)
      : ("extracting" as const);

    await ctx.db.patch(args.rawFileId, {
      extractionResults: results,
      status: overallStatus,
    });

    return null;
  },
});

export const setExtracting = internalMutation({
  args: {
    rawFileId: v.id("rawFiles"),
    extractorNames: v.array(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const initialResults = args.extractorNames.map((name) => ({
      extractorName: name,
      status: "running" as const,
      entryCount: 0,
    }));

    await ctx.db.patch(args.rawFileId, {
      status: "extracting" as const,
      extractionResults: initialResults,
    });

    return null;
  },
});

export const generateUploadUrl = mutation({
  args: {},
  returns: v.string(),
  handler: async (ctx) => {
    return await ctx.storage.generateUploadUrl();
  },
});

export const countBySource = query({
  args: {
    source: v.string(),
  },
  returns: v.number(),
  handler: async (ctx, args) => {
    const results = await ctx.db
      .query("rawFiles")
      .withIndex("by_source_timestamp", (q) => q.eq("source", args.source))
      .collect();
    return results.length;
  },
});

export const getById = internalQuery({
  args: {
    id: v.id("rawFiles"),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

export const triggerExtractor = mutation({
  args: {
    rawFileId: v.id("rawFiles"),
    extractorName: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const rawFile = await ctx.db.get(args.rawFileId);
    if (!rawFile) throw new Error("Raw file not found");
    const results = [...(rawFile.extractionResults ?? [])];
    const existingIdx = results.findIndex((r) => r.extractorName === args.extractorName);
    if (existingIdx === -1) {
      results.push({ extractorName: args.extractorName, status: "pending" as const, entryCount: 0 });
    } else {
      results[existingIdx] = { ...results[existingIdx], status: "pending" as const, entryCount: 0, error: undefined };
    }
    await ctx.db.patch(args.rawFileId, { status: "extracting" as const, extractionResults: results });
    await extractionPool.enqueueAction(ctx, internal.extraction.runExtractor,
      { rawFileId: args.rawFileId, extractorName: args.extractorName },
      { onComplete: handleExtractionComplete, context: { rawFileId: args.rawFileId, extractorName: args.extractorName } }
    );
    return null;
  },
});
