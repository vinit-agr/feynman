import { v } from "convex/values";
import { query, mutation } from "./_generated/server";

export const list = query({
  args: {},
  returns: v.any(),
  handler: async (ctx) => {
    return await ctx.db.query("sources").collect();
  },
});

export const upsert = mutation({
  args: {
    type: v.string(),
    name: v.string(),
    config: v.optional(v.any()),
    lastIngestedAt: v.optional(v.number()),
    entryCount: v.optional(v.number()),
    enabled: v.boolean(),
  },
  returns: v.id("sources"),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("sources")
      .withIndex("by_type", (q) => q.eq("type", args.type))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        name: args.name,
        config: args.config,
        lastIngestedAt: args.lastIngestedAt,
        entryCount: args.entryCount,
        enabled: args.enabled,
      });
      return existing._id;
    }

    return await ctx.db.insert("sources", args);
  },
});

export const updateLastIngested = mutation({
  args: {
    type: v.string(),
    lastIngestedAt: v.number(),
    entryCount: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const source = await ctx.db
      .query("sources")
      .withIndex("by_type", (q) => q.eq("type", args.type))
      .unique();

    if (!source) {
      throw new Error(`Source not found with type: ${args.type}`);
    }

    const patch: Record<string, unknown> = {
      lastIngestedAt: args.lastIngestedAt,
    };
    if (args.entryCount !== undefined) {
      patch.entryCount = args.entryCount;
    }

    await ctx.db.patch(source._id, patch);
    return null;
  },
});
