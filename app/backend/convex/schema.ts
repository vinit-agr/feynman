import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // Individual pieces of knowledge ingested from any source
  knowledgeEntries: defineTable({
    source: v.string(), // "claude-transcript" | "git-commit" | "youtube" | "twitter" | "telegram" | etc.
    sourceId: v.string(), // Unique ID from source (for dedup)
    title: v.string(),
    content: v.string(),
    summary: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    url: v.optional(v.string()),
    timestamp: v.number(), // When this knowledge was created/captured
    metadata: v.optional(v.any()),
    embedding: v.optional(v.array(v.float64())),
  })
    .index("by_source", ["source", "timestamp"])
    .index("by_source_id", ["source", "sourceId"])
    .index("by_timestamp", ["timestamp"])
    .searchIndex("search_content", {
      searchField: "content",
      filterFields: ["source"],
    })
    .vectorIndex("by_embedding", {
      vectorField: "embedding",
      dimensions: 1536,
      filterFields: ["source"],
    }),

  // Items in the knowledge curation pipeline
  knowledgeItems: defineTable({
    stage: v.union(
      v.literal("ideas"),
      v.literal("researching"),
      v.literal("learning"),
      v.literal("curated")
    ),
    topic: v.string(),
    description: v.optional(v.string()),
    linkedEntryIds: v.optional(v.array(v.id("knowledgeEntries"))),
    notes: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_stage", ["stage", "updatedAt"])
    .index("by_created", ["createdAt"]),

  // Items in the content creation pipeline
  contentItems: defineTable({
    stage: v.union(
      v.literal("ideas"),
      v.literal("researching"),
      v.literal("scripting"),
      v.literal("production"),
      v.literal("editing"),
      v.literal("review"),
      v.literal("published"),
      v.literal("archive")
    ),
    title: v.string(),
    description: v.optional(v.string()),
    format: v.union(
      v.literal("talking-head"),
      v.literal("ai-video"),
      v.literal("blog"),
      v.literal("twitter-thread"),
      v.literal("linkedin-post"),
      v.literal("other")
    ),
    script: v.optional(v.string()),
    linkedKnowledgeItemIds: v.optional(v.array(v.id("knowledgeItems"))),
    linkedEntryIds: v.optional(v.array(v.id("knowledgeEntries"))),
    notes: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    publishedUrl: v.optional(v.string()),
    autoPopulated: v.optional(v.boolean()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_stage", ["stage", "updatedAt"])
    .index("by_format", ["format", "stage"])
    .index("by_created", ["createdAt"]),

  // Generated weekly digests
  digests: defineTable({
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
    createdAt: v.number(),
  })
    .index("by_date", ["endDate"]),

  // Registered knowledge sources
  sources: defineTable({
    type: v.string(),
    name: v.string(),
    config: v.optional(v.any()),
    lastIngestedAt: v.optional(v.number()),
    entryCount: v.optional(v.number()),
    enabled: v.boolean(),
  })
    .index("by_type", ["type"]),
});
