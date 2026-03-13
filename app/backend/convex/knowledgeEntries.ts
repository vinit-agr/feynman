import { v } from "convex/values";
import { query, mutation } from "./_generated/server";

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
