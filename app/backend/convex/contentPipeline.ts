import { v } from "convex/values";
import { query, mutation } from "./_generated/server";

const stageValidator = v.union(
  v.literal("ideas"),
  v.literal("researching"),
  v.literal("scripting"),
  v.literal("production"),
  v.literal("editing"),
  v.literal("review"),
  v.literal("published"),
  v.literal("archive")
);

const formatValidator = v.union(
  v.literal("talking-head"),
  v.literal("ai-video"),
  v.literal("blog"),
  v.literal("twitter-thread"),
  v.literal("linkedin-post"),
  v.literal("other")
);

export const list = query({
  args: {
    stage: v.optional(stageValidator),
    format: v.optional(formatValidator),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    if (args.format && args.stage) {
      return await ctx.db
        .query("contentItems")
        .withIndex("by_format", (q) =>
          q.eq("format", args.format!).eq("stage", args.stage!)
        )
        .order("desc")
        .collect();
    }
    if (args.stage) {
      return await ctx.db
        .query("contentItems")
        .withIndex("by_stage", (q) => q.eq("stage", args.stage!))
        .order("desc")
        .collect();
    }
    if (args.format) {
      return await ctx.db
        .query("contentItems")
        .withIndex("by_format", (q) => q.eq("format", args.format!))
        .order("desc")
        .collect();
    }
    return await ctx.db
      .query("contentItems")
      .order("desc")
      .collect();
  },
});

export const create = mutation({
  args: {
    stage: stageValidator,
    title: v.string(),
    description: v.optional(v.string()),
    format: formatValidator,
    script: v.optional(v.string()),
    linkedKnowledgeItemIds: v.optional(v.array(v.id("knowledgeItems"))),
    linkedEntryIds: v.optional(v.array(v.id("knowledgeEntries"))),
    notes: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    publishedUrl: v.optional(v.string()),
    autoPopulated: v.optional(v.boolean()),
  },
  returns: v.id("contentItems"),
  handler: async (ctx, args) => {
    const now = Date.now();
    return await ctx.db.insert("contentItems", {
      ...args,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const updateStage = mutation({
  args: {
    id: v.id("contentItems"),
    stage: stageValidator,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      stage: args.stage,
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const update = mutation({
  args: {
    id: v.id("contentItems"),
    stage: v.optional(stageValidator),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    format: v.optional(formatValidator),
    script: v.optional(v.string()),
    linkedKnowledgeItemIds: v.optional(v.array(v.id("knowledgeItems"))),
    linkedEntryIds: v.optional(v.array(v.id("knowledgeEntries"))),
    notes: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    publishedUrl: v.optional(v.string()),
    autoPopulated: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { id, ...fields } = args;
    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    for (const [key, value] of Object.entries(fields)) {
      if (value !== undefined) {
        patch[key] = value;
      }
    }
    await ctx.db.patch(id, patch);
    return null;
  },
});

export const remove = mutation({
  args: {
    id: v.id("contentItems"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.delete(args.id);
    return null;
  },
});

export const promoteFromKnowledge = mutation({
  args: {
    knowledgeItemId: v.id("knowledgeItems"),
    format: formatValidator,
  },
  returns: v.id("contentItems"),
  handler: async (ctx, args) => {
    const knowledgeItem = await ctx.db.get(args.knowledgeItemId);
    if (!knowledgeItem) {
      throw new Error(`Knowledge item not found: ${args.knowledgeItemId}`);
    }

    const now = Date.now();
    return await ctx.db.insert("contentItems", {
      stage: "ideas",
      title: knowledgeItem.topic,
      description: knowledgeItem.description,
      format: args.format,
      linkedKnowledgeItemIds: [args.knowledgeItemId],
      linkedEntryIds: knowledgeItem.linkedEntryIds,
      notes: knowledgeItem.notes,
      tags: knowledgeItem.tags,
      createdAt: now,
      updatedAt: now,
    });
  },
});
