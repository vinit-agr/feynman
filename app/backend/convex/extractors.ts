import { v } from "convex/values";
import { query, mutation, internalQuery } from "./_generated/server";

export const list = query({
  args: {
    source: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    if (args.source) {
      return await ctx.db
        .query("extractors")
        .withIndex("by_source", (q) => q.eq("source", args.source!))
        .collect();
    }
    return await ctx.db.query("extractors").collect();
  },
});

export const getBySourceName = query({
  args: {
    source: v.string(),
    name: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    return await ctx.db
      .query("extractors")
      .withIndex("by_source_name", (q) =>
        q.eq("source", args.source).eq("name", args.name)
      )
      .unique();
  },
});

export const getAutoRunForSource = query({
  args: {
    source: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const extractors = await ctx.db
      .query("extractors")
      .withIndex("by_source", (q) => q.eq("source", args.source))
      .collect();
    return extractors.filter((e) => e.autoRun && e.enabled);
  },
});

export const getBySourceNameInternal = internalQuery({
  args: {
    source: v.string(),
    name: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    return await ctx.db
      .query("extractors")
      .withIndex("by_source_name", (q) =>
        q.eq("source", args.source).eq("name", args.name)
      )
      .unique();
  },
});

export const seed = mutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    // Upsert "project-work-summary" extractor
    const workSummarySource = "claude-transcripts";
    const existing1 = await ctx.db
      .query("extractors")
      .withIndex("by_source_name", (q) =>
        q.eq("source", workSummarySource).eq("name", "project-work-summary")
      )
      .unique();

    const workSummaryData = {
      source: workSummarySource,
      name: "project-work-summary",
      displayName: "Project Work Summary",
      description: "Extracts a mechanical summary of project work performed in a Claude session",
      type: "mechanical" as const,
      parserName: "claude-strip-tools",
      autoRun: true,
      enabled: true,
    };

    if (existing1) {
      await ctx.db.patch(existing1._id, workSummaryData);
    } else {
      await ctx.db.insert("extractors", workSummaryData);
    }

    // Upsert "engineering-decisions" extractor
    const existing2 = await ctx.db
      .query("extractors")
      .withIndex("by_source_name", (q) =>
        q.eq("source", workSummarySource).eq("name", "engineering-decisions")
      )
      .unique();

    const engDecisionsData = {
      source: workSummarySource,
      name: "engineering-decisions",
      displayName: "Engineering Decisions",
      description: "Uses AI to extract notable engineering decisions and architectural choices from a Claude session",
      type: "ai" as const,
      autoRun: false,
      enabled: true,
    };

    if (existing2) {
      await ctx.db.patch(existing2._id, engDecisionsData);
    } else {
      await ctx.db.insert("extractors", engDecisionsData);
    }

    return null;
  },
});
