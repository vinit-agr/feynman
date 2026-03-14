import { v } from "convex/values";
import { query, mutation, internalMutation, internalQuery } from "./_generated/server";

// Workpool instance for enqueuing extraction jobs
import { extractionPool } from "./extractionPool";
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
    const all = await ctx.db
      .query("rawFiles")
      .withIndex("by_source_timestamp", (q) => q.eq("source", args.source))
      .order("desc")
      .collect();
    return all.filter((f) => f.deleted !== true).slice(0, limit);
  },
});

export const create = mutation({
  args: {
    source: v.string(),
    sourceId: v.string(),
    storageId: v.optional(v.id("_storage")),
    projectPath: v.optional(v.string()),
    projectName: v.optional(v.string()),
    sessionId: v.optional(v.string()),
    fileName: v.string(),
    localFileSize: v.number(),
    localModifiedAt: v.number(),
    timestamp: v.number(),
    projectId: v.optional(v.id("projects")),
    deleted: v.optional(v.boolean()),
  },
  returns: v.id("rawFiles"),
  handler: async (ctx, args) => {
    const isDeleted = args.deleted === true;

    // Skip extraction setup for deleted files (zero-message markers)
    if (isDeleted) {
      return await ctx.db.insert("rawFiles", {
        ...args,
        status: "uploaded" as const,
        extractionResults: [],
        deleted: true,
      });
    }

    // Query auto-run extractors for this source before inserting
    const autoRunExtractors = await ctx.db
      .query("extractors")
      .withIndex("by_source", (q) => q.eq("source", args.source))
      .collect()
      .then((list) => list.filter((e) => e.autoRun && e.enabled));

    const extractionResults = autoRunExtractors.map((e) => ({
      extractorName: e.name,
      status: "pending" as const,
      entryCount: 0,
    }));

    const status = autoRunExtractors.length > 0 ? ("extracting" as const) : ("uploaded" as const);

    const rawFileId = await ctx.db.insert("rawFiles", {
      ...args,
      status,
      extractionResults,
      deleted: false,
    });

    // Enqueue a workpool action for each auto-run extractor
    for (const extractor of autoRunExtractors) {
      await extractionPool.enqueueAction(
        ctx,
        internal.extraction.runExtractor,
        { rawFileId, extractorName: extractor.name },
        {
          onComplete: internal.extractionPool.handleExtractionComplete,
          context: { rawFileId, extractorName: extractor.name },
        }
      );
    }

    return rawFileId;
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

    // Fetch rawFile to know its source
    const rawFile = await ctx.db.get(id);
    if (!rawFile) throw new Error("Raw file not found");

    // Query auto-run extractors for this source
    const autoRunExtractors = await ctx.db
      .query("extractors")
      .withIndex("by_source", (q) => q.eq("source", rawFile.source))
      .collect()
      .then((list) => list.filter((e) => e.autoRun && e.enabled));

    const extractionResults = autoRunExtractors.map((e) => ({
      extractorName: e.name,
      status: "pending" as const,
      entryCount: 0,
    }));

    const status = autoRunExtractors.length > 0 ? ("extracting" as const) : ("uploaded" as const);

    await ctx.db.patch(id, {
      ...rest,
      status,
      extractionResults,
    });

    // Enqueue a workpool action for each auto-run extractor
    for (const extractor of autoRunExtractors) {
      await extractionPool.enqueueAction(
        ctx,
        internal.extraction.runExtractor,
        { rawFileId: id, extractorName: extractor.name },
        {
          onComplete: internal.extractionPool.handleExtractionComplete,
          context: { rawFileId: id, extractorName: extractor.name },
        }
      );
    }

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

export const getDownloadUrl = query({
  args: { storageId: v.id("_storage") },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, args) => {
    return await ctx.storage.getUrl(args.storageId);
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
    return results.filter((f) => f.deleted !== true).length;
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
      { onComplete: internal.extractionPool.handleExtractionComplete, context: { rawFileId: args.rawFileId, extractorName: args.extractorName } }
    );
    return null;
  },
});

export const moveToProject = mutation({
  args: {
    rawFileId: v.id("rawFiles"),
    projectId: v.id("projects"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const rawFile = await ctx.db.get(args.rawFileId);
    if (!rawFile) throw new Error("Raw file not found");

    const oldProjectId = rawFile.projectId;
    await ctx.db.patch(args.rawFileId, { projectId: args.projectId });

    // Update lastActivityAt on the new project
    await ctx.db.patch(args.projectId, { lastActivityAt: Date.now() });

    // Update lastActivityAt on the old project if it exists
    if (oldProjectId) {
      const oldProject = await ctx.db.get(oldProjectId);
      if (oldProject) {
        await ctx.db.patch(oldProjectId, { lastActivityAt: Date.now() });
      }
    }

    return null;
  },
});

export const softDelete = mutation({
  args: {
    rawFileId: v.id("rawFiles"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const rawFile = await ctx.db.get(args.rawFileId);
    if (!rawFile) throw new Error("Raw file not found");

    // Soft-delete the rawFile
    await ctx.db.patch(args.rawFileId, { deleted: true });

    // Hard-delete associated knowledgeEntries
    const entries = await ctx.db
      .query("knowledgeEntries")
      .withIndex("by_rawFile_extractor", (q) => q.eq("rawFileId", args.rawFileId))
      .collect();
    for (const entry of entries) {
      await ctx.db.delete(entry._id);
    }

    // Update lastActivityAt on the project if it exists
    if (rawFile.projectId) {
      const project = await ctx.db.get(rawFile.projectId);
      if (project) {
        await ctx.db.patch(rawFile.projectId, { lastActivityAt: Date.now() });
      }
    }

    return null;
  },
});

export const listByProject = query({
  args: {
    projectId: v.id("projects"),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const files = await ctx.db
      .query("rawFiles")
      .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))
      .collect();
    return files
      .filter((f) => f.deleted !== true)
      .sort((a, b) => b.timestamp - a.timestamp);
  },
});

export const listUngrouped = query({
  args: {
    source: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const files = await ctx.db
      .query("rawFiles")
      .withIndex("by_source_timestamp", (q) => q.eq("source", args.source))
      .order("desc")
      .collect();
    return files.filter(
      (f) => f.deleted !== true && f.projectId === undefined
    );
  },
});

export const listAll = query({
  args: {
    source: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    return await ctx.db
      .query("rawFiles")
      .withIndex("by_source_timestamp", (q) => q.eq("source", args.source))
      .collect();
  },
});

export const deleteBySource = mutation({
  args: {
    source: v.string(),
  },
  returns: v.number(),
  handler: async (ctx, args) => {
    const files = await ctx.db
      .query("rawFiles")
      .withIndex("by_source_timestamp", (q) => q.eq("source", args.source))
      .collect();
    for (const file of files) {
      await ctx.db.delete(file._id);
    }
    return files.length;
  },
});

export const deleteStorageFile = mutation({
  args: {
    storageId: v.id("_storage"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.storage.delete(args.storageId);
    return null;
  },
});
