import { v } from "convex/values";
import { query, mutation } from "./_generated/server";

export const create = mutation({
  args: {
    name: v.string(),
    source: v.string(),
  },
  returns: v.id("projects"),
  handler: async (ctx, args) => {
    // Find max order for this source
    const existing = await ctx.db
      .query("projects")
      .withIndex("by_source", (q) => q.eq("source", args.source))
      .collect();
    const maxOrder = existing.reduce(
      (max, p) => (p.order !== undefined && p.order > max ? p.order : max),
      -1
    );

    return await ctx.db.insert("projects", {
      name: args.name,
      source: args.source,
      order: maxOrder + 1,
      lastActivityAt: Date.now(),
      createdAt: Date.now(),
    });
  },
});

export const rename = mutation({
  args: {
    projectId: v.id("projects"),
    newName: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId);
    if (!project) throw new Error("Project not found");
    await ctx.db.patch(args.projectId, { name: args.newName });
    return null;
  },
});

export const remove = mutation({
  args: {
    projectId: v.id("projects"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId);
    if (!project) throw new Error("Project not found");

    // Get all rawFiles in this project
    const rawFiles = await ctx.db
      .query("rawFiles")
      .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))
      .collect();

    // Soft-delete each rawFile and hard-delete its knowledgeEntries
    for (const rawFile of rawFiles) {
      await ctx.db.patch(rawFile._id, { deleted: true });

      // Delete associated knowledgeEntries
      const entries = await ctx.db
        .query("knowledgeEntries")
        .withIndex("by_rawFile_extractor", (q) => q.eq("rawFileId", rawFile._id))
        .collect();
      for (const entry of entries) {
        await ctx.db.delete(entry._id);
      }
    }

    // Hard-delete the project row
    await ctx.db.delete(args.projectId);
    return null;
  },
});

export const reorder = mutation({
  args: {
    projectIds: v.array(v.id("projects")),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    for (let i = 0; i < args.projectIds.length; i++) {
      await ctx.db.patch(args.projectIds[i], { order: i });
    }
    return null;
  },
});

export const listBySource = query({
  args: {
    source: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const projects = await ctx.db
      .query("projects")
      .withIndex("by_source", (q) => q.eq("source", args.source))
      .collect();

    // Sort: manually ordered projects first (by order asc), then unordered by lastActivityAt desc
    return projects.sort((a, b) => {
      const aHasOrder = a.order !== undefined;
      const bHasOrder = b.order !== undefined;
      if (aHasOrder && bHasOrder) return a.order! - b.order!;
      if (aHasOrder && !bHasOrder) return -1;
      if (!aHasOrder && bHasOrder) return 1;
      return b.lastActivityAt - a.lastActivityAt;
    });
  },
});

export const findOrCreate = mutation({
  args: {
    name: v.string(),
    source: v.string(),
  },
  returns: v.id("projects"),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("projects")
      .withIndex("by_source_name", (q) =>
        q.eq("source", args.source).eq("name", args.name)
      )
      .unique();

    if (existing) return existing._id;

    // Find max order for this source
    const allProjects = await ctx.db
      .query("projects")
      .withIndex("by_source", (q) => q.eq("source", args.source))
      .collect();
    const maxOrder = allProjects.reduce(
      (max, p) => (p.order !== undefined && p.order > max ? p.order : max),
      -1
    );

    return await ctx.db.insert("projects", {
      name: args.name,
      source: args.source,
      order: maxOrder + 1,
      lastActivityAt: Date.now(),
      createdAt: Date.now(),
    });
  },
});
