import { v } from "convex/values";
import { query, mutation } from "./_generated/server";

const stageValidator = v.union(
  v.literal("ideas"),
  v.literal("researching"),
  v.literal("learning"),
  v.literal("curated")
);

export const list = query({
  args: {
    stage: v.optional(stageValidator),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    if (args.stage) {
      return await ctx.db
        .query("knowledgeItems")
        .withIndex("by_stage", (q) => q.eq("stage", args.stage!))
        .order("desc")
        .collect();
    }
    return await ctx.db
      .query("knowledgeItems")
      .order("desc")
      .collect();
  },
});

export const create = mutation({
  args: {
    stage: stageValidator,
    topic: v.string(),
    description: v.optional(v.string()),
    linkedEntryIds: v.optional(v.array(v.id("knowledgeEntries"))),
    notes: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
  },
  returns: v.id("knowledgeItems"),
  handler: async (ctx, args) => {
    const now = Date.now();
    return await ctx.db.insert("knowledgeItems", {
      ...args,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const updateStage = mutation({
  args: {
    id: v.id("knowledgeItems"),
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
    id: v.id("knowledgeItems"),
    stage: v.optional(stageValidator),
    topic: v.optional(v.string()),
    description: v.optional(v.string()),
    linkedEntryIds: v.optional(v.array(v.id("knowledgeEntries"))),
    notes: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { id, ...fields } = args;
    // Remove undefined fields
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
    id: v.id("knowledgeItems"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.delete(args.id);
    return null;
  },
});
