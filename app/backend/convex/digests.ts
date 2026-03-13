import { v } from "convex/values";
import { query, mutation } from "./_generated/server";

export const list = query({
  args: {
    limit: v.optional(v.number()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const limit = args.limit ?? 10;
    return await ctx.db
      .query("digests")
      .withIndex("by_date")
      .order("desc")
      .take(limit);
  },
});

export const getLatest = query({
  args: {},
  returns: v.any(),
  handler: async (ctx) => {
    return await ctx.db
      .query("digests")
      .withIndex("by_date")
      .order("desc")
      .first();
  },
});

export const create = mutation({
  args: {
    startDate: v.number(),
    endDate: v.number(),
    activitySummary: v.string(),
    keyThemes: v.array(v.string()),
    contentIdeas: v.array(
      v.object({
        title: v.string(),
        format: v.string(),
        reasoning: v.string(),
      })
    ),
    knowledgeGaps: v.optional(v.array(v.string())),
    notableSaves: v.optional(v.array(v.string())),
    rawMarkdown: v.string(),
  },
  returns: v.id("digests"),
  handler: async (ctx, args) => {
    return await ctx.db.insert("digests", {
      ...args,
      createdAt: Date.now(),
    });
  },
});
