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
    rawFileId: v.optional(v.id("rawFiles")),
    extractorName: v.optional(v.string()),
  })
    .index("by_source", ["source", "timestamp"])
    .index("by_source_id", ["source", "sourceId"])
    .index("by_timestamp", ["timestamp"])
    .index("by_rawFile_extractor", ["rawFileId", "extractorName"])
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

  // Project groups for organizing raw files
  projects: defineTable({
    name: v.string(),
    source: v.string(),
    order: v.optional(v.number()),
    lastActivityAt: v.number(),
    createdAt: v.number(),
  })
    .index("by_source", ["source"])
    .index("by_source_order", ["source", "order"])
    .index("by_source_name", ["source", "name"]),

  // Raw files uploaded from local sources (stored in Convex file storage)
  rawFiles: defineTable({
    source: v.string(),                        // e.g., "claude-transcripts", "git-history"
    sourceId: v.string(),                      // unique per file, e.g., "claude:session-uuid"
    storageId: v.optional(v.id("_storage")),   // reference to Convex file storage (optional for zero-message files)
    projectPath: v.optional(v.string()),
    projectName: v.optional(v.string()),
    sessionId: v.optional(v.string()),
    fileName: v.string(),
    localFileSize: v.number(),
    localModifiedAt: v.number(),
    timestamp: v.number(),                     // file mtime at upload
    status: v.union(
      v.literal("uploaded"),
      v.literal("extracting"),
      v.literal("extracted"),
      v.literal("failed")
    ),
    extractionResults: v.optional(v.array(v.object({
      extractorName: v.string(),
      status: v.union(
        v.literal("pending"),
        v.literal("running"),
        v.literal("completed"),
        v.literal("failed")
      ),
      entryCount: v.number(),
      error: v.optional(v.string()),
    }))),
    projectId: v.optional(v.id("projects")),   // project group reference
    deleted: v.optional(v.boolean()),           // soft-delete flag
  })
    .index("by_source_sourceId", ["source", "sourceId"])
    .index("by_source_status", ["source", "status"])
    .index("by_source_timestamp", ["source", "timestamp"])
    .index("by_projectId", ["projectId"])
    .index("by_source_deleted", ["source", "deleted"]),

  // Registry of available extractors per source
  extractors: defineTable({
    source: v.string(),
    name: v.string(),
    displayName: v.string(),
    description: v.string(),
    type: v.union(v.literal("mechanical"), v.literal("ai")),
    autoRun: v.boolean(),
    enabled: v.boolean(),
    parserName: v.optional(v.string()),
    promptTemplate: v.optional(v.string()),
    rendererType: v.optional(v.string()),
  })
    .index("by_source", ["source"])
    .index("by_source_name", ["source", "name"]),

  // Runtime configuration for scheduled jobs (visibility + control layer)
  cronConfig: defineTable({
    name: v.string(),           // Unique cron identifier, e.g. "weekly-digest"
    description: v.string(),    // Human-readable, e.g. "Generate weekly digest"
    schedule: v.string(),       // Human-readable schedule, e.g. "Every Friday at 23:00 UTC"
    functionName: v.string(),   // Convex function reference, e.g. "digestAction:generateWeekly"
    enabled: v.boolean(),       // Toggle — cron function checks this before running
    lastRunAt: v.optional(v.number()),
    lastStatus: v.optional(v.union(
      v.literal("success"),
      v.literal("error"),
      v.literal("skipped")
    )),
    lastError: v.optional(v.string()),
    runCount: v.number(),
  })
    .index("by_name", ["name"]),
});
