import { query, mutation, internalMutation } from "./_generated/server";
import { v } from "convex/values";

// List all cron configs (for the frontend settings page)
export const list = query({
  args: {},
  returns: v.array(v.any()),
  handler: async (ctx) => {
    return await ctx.db.query("cronConfig").collect();
  },
});

// Get a specific cron config by name (used by cron functions to check if enabled)
export const getByName = query({
  args: { name: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => {
    return await ctx.db
      .query("cronConfig")
      .withIndex("by_name", (q) => q.eq("name", args.name))
      .first();
  },
});

// Toggle enabled/disabled (called from frontend)
export const setEnabled = mutation({
  args: { name: v.string(), enabled: v.boolean() },
  handler: async (ctx, args) => {
    const config = await ctx.db
      .query("cronConfig")
      .withIndex("by_name", (q) => q.eq("name", args.name))
      .first();
    if (!config) throw new Error(`Cron config not found: ${args.name}`);
    await ctx.db.patch(config._id, { enabled: args.enabled });
  },
});

// Record a cron run result (called by cron functions after execution)
export const recordRun = internalMutation({
  args: {
    name: v.string(),
    status: v.union(v.literal("success"), v.literal("error"), v.literal("skipped")),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const config = await ctx.db
      .query("cronConfig")
      .withIndex("by_name", (q) => q.eq("name", args.name))
      .first();
    if (!config) return;
    await ctx.db.patch(config._id, {
      lastRunAt: Date.now(),
      lastStatus: args.status,
      lastError: args.error,
      runCount: config.runCount + (args.status !== "skipped" ? 1 : 0),
    });
  },
});

// Seed initial cron config (run once during setup or on first deploy)
export const seed = mutation({
  args: {},
  handler: async (ctx) => {
    const existing = await ctx.db
      .query("cronConfig")
      .withIndex("by_name", (q) => q.eq("name", "weekly-digest"))
      .first();
    if (existing) return "already seeded";

    await ctx.db.insert("cronConfig", {
      name: "weekly-digest",
      description: "Generate weekly digest summarizing knowledge activity",
      schedule: "Every Friday at 23:00 UTC (~6 PM ET)",
      functionName: "digestAction:generateWeekly",
      enabled: true,
      runCount: 0,
    });
    return "seeded";
  },
});
