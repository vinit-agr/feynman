import { v } from "convex/values";
import { query, mutation, internalMutation } from "./_generated/server";

export const list = query({
  args: {
    source: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const limit = args.limit ?? 50;
    if (args.source) {
      return await ctx.db
        .query("knowledgeEntries")
        .withIndex("by_source", (q) => q.eq("source", args.source!))
        .order("desc")
        .take(limit);
    }
    return await ctx.db
      .query("knowledgeEntries")
      .order("desc")
      .take(limit);
  },
});

export const getBySourceId = query({
  args: {
    source: v.string(),
    sourceId: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    return await ctx.db
      .query("knowledgeEntries")
      .withIndex("by_source_id", (q) =>
        q.eq("source", args.source).eq("sourceId", args.sourceId)
      )
      .unique();
  },
});

export const create = mutation({
  args: {
    source: v.string(),
    sourceId: v.string(),
    title: v.string(),
    content: v.string(),
    summary: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    url: v.optional(v.string()),
    timestamp: v.number(),
    metadata: v.optional(v.any()),
    embedding: v.optional(v.array(v.float64())),
    rawFileId: v.optional(v.id("rawFiles")),
    extractorName: v.optional(v.string()),
  },
  returns: v.id("knowledgeEntries"),
  handler: async (ctx, args) => {
    return await ctx.db.insert("knowledgeEntries", args);
  },
});

export const upsert = mutation({
  args: {
    source: v.string(),
    sourceId: v.string(),
    title: v.string(),
    content: v.string(),
    summary: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    url: v.optional(v.string()),
    timestamp: v.number(),
    metadata: v.optional(v.any()),
    embedding: v.optional(v.array(v.float64())),
    rawFileId: v.optional(v.id("rawFiles")),
    extractorName: v.optional(v.string()),
  },
  returns: v.id("knowledgeEntries"),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("knowledgeEntries")
      .withIndex("by_source_id", (q) =>
        q.eq("source", args.source).eq("sourceId", args.sourceId)
      )
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        title: args.title,
        content: args.content,
        summary: args.summary,
        tags: args.tags,
        url: args.url,
        timestamp: args.timestamp,
        metadata: args.metadata,
        embedding: args.embedding,
        rawFileId: args.rawFileId,
        extractorName: args.extractorName,
      });
      return existing._id;
    }

    return await ctx.db.insert("knowledgeEntries", args);
  },
});

export const search = query({
  args: {
    query: v.string(),
    source: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    let searchQuery = ctx.db
      .query("knowledgeEntries")
      .withSearchIndex("search_content", (q) => {
        const base = q.search("content", args.query);
        if (args.source) {
          return base.eq("source", args.source);
        }
        return base;
      });
    return await searchQuery.collect();
  },
});

export const getRecent = query({
  args: {
    after: v.number(),
    limit: v.optional(v.number()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const limit = args.limit ?? 200;
    return await ctx.db
      .query("knowledgeEntries")
      .withIndex("by_timestamp", (q) => q.gt("timestamp", args.after))
      .order("desc")
      .take(limit);
  },
});

export const getById = query({
  args: {
    id: v.id("knowledgeEntries"),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

export const listByRawFile = query({
  args: {
    rawFileId: v.id("rawFiles"),
    extractorName: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    if (args.extractorName) {
      return await ctx.db
        .query("knowledgeEntries")
        .withIndex("by_rawFile_extractor", (q) =>
          q.eq("rawFileId", args.rawFileId).eq("extractorName", args.extractorName)
        )
        .collect();
    }
    return await ctx.db
      .query("knowledgeEntries")
      .withIndex("by_rawFile_extractor", (q) => q.eq("rawFileId", args.rawFileId))
      .collect();
  },
});

export const listBySourceAndExtractor = query({
  args: {
    source: v.string(),
    extractorName: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const limit = args.limit ?? 50;
    const entries = await ctx.db
      .query("knowledgeEntries")
      .withIndex("by_source", (q) => q.eq("source", args.source))
      .order("desc")
      .collect();

    if (args.extractorName) {
      return entries
        .filter((e) => e.extractorName === args.extractorName)
        .slice(0, limit);
    }
    return entries.slice(0, limit);
  },
});

// TEMPORARY: Run once to delete old claude-transcripts entries that were created
// directly (without rawFileId) by the old ingestion script. Remove after running.
export const cleanupOldEntries = mutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const old = await ctx.db
      .query("knowledgeEntries")
      .withIndex("by_source", (q) => q.eq("source", "claude-transcripts"))
      .collect();
    let count = 0;
    for (const entry of old) {
      if (!entry.rawFileId) {
        await ctx.db.delete(entry._id);
        count++;
      }
    }
    return count;
  },
});

export const deleteBySource = mutation({
  args: {
    source: v.string(),
  },
  returns: v.number(),
  handler: async (ctx, args) => {
    const entries = await ctx.db
      .query("knowledgeEntries")
      .withIndex("by_source", (q) => q.eq("source", args.source))
      .collect();
    for (const entry of entries) {
      await ctx.db.delete(entry._id);
    }
    return entries.length;
  },
});

export const getTitlesByRawFileIds = query({
  args: {
    rawFileIds: v.array(v.id("rawFiles")),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const result: Record<string, string> = {};
    for (const rawFileId of args.rawFileIds) {
      const entry = await ctx.db
        .query("knowledgeEntries")
        .withIndex("by_rawFile_extractor", (q) => q.eq("rawFileId", rawFileId))
        .first();
      if (entry) {
        result[rawFileId] = entry.title;
      }
    }
    return result;
  },
});

export const upsertFromExtractor = internalMutation({
  args: {
    source: v.string(),
    sourceId: v.string(),
    title: v.string(),
    content: v.string(),
    summary: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    url: v.optional(v.string()),
    timestamp: v.number(),
    metadata: v.optional(v.any()),
    rawFileId: v.id("rawFiles"),
    extractorName: v.string(),
  },
  returns: v.id("knowledgeEntries"),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("knowledgeEntries")
      .withIndex("by_rawFile_extractor", (q) =>
        q.eq("rawFileId", args.rawFileId).eq("extractorName", args.extractorName)
      )
      .filter((q) => q.eq(q.field("sourceId"), args.sourceId))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        title: args.title,
        content: args.content,
        summary: args.summary,
        tags: args.tags,
        url: args.url,
        timestamp: args.timestamp,
        metadata: args.metadata,
      });
      return existing._id;
    }

    return await ctx.db.insert("knowledgeEntries", args);
  },
});
