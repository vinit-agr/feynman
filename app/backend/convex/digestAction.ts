"use node";

import { action } from "./_generated/server";
import { v } from "convex/values";
import { api, internal } from "./_generated/api";
import Anthropic from "@anthropic-ai/sdk";

const DEFAULT_DAYS_BACK = 7;
const MAX_CONTENT_PER_ENTRY = 2000;
const MAX_ENTRIES_PER_SOURCE = 50;
const CRON_NAME = "weekly-digest";

function buildSystemPrompt(): string {
  return `You are a personal content strategist and knowledge synthesizer for a builder who creates authentic content based on their real work.

Your job is to analyze recent knowledge entries — code conversations, git commits, bookmarks, notes — and produce a structured weekly digest.

Philosophy:
- "Building in public" — sharing learnings, process, and honest reflections
- Authenticity over polish — real experiences resonate more than manufactured content
- Content should emerge naturally from the work, not be forced
- Match format to content: complex technical deep-dives → blog posts or talking-head videos, fun experiments → AI-animated videos, quick insights → twitter threads, professional reflections → LinkedIn posts

Respond with ONLY a valid JSON object (no markdown code fences):
{
  "activitySummary": "2-3 paragraphs summarizing what was worked on",
  "keyThemes": ["3-5 recurring topics or themes"],
  "contentIdeas": [{"title": "...", "format": "talking-head | ai-video | blog | twitter-thread | linkedin-post", "reasoning": "..."}],
  "knowledgeGaps": ["2-3 areas explored but not fully resolved"],
  "notableSaves": ["Interesting bookmarks or references worth highlighting"],
  "rawMarkdown": "Full digest formatted as readable markdown"
}`;
}

export const generateWeekly = action({
  args: {
    daysBack: v.optional(v.number()),
    manual: v.optional(v.boolean()),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    const isManual = args.manual ?? false;

    // Check cronConfig — skip if disabled (unless manually triggered)
    if (!isManual) {
      const config = await ctx.runQuery(api.cronConfig.getByName, {
        name: CRON_NAME,
      });
      if (config && !config.enabled) {
        await ctx.runMutation(internal.cronConfig.recordRun, {
          name: CRON_NAME,
          status: "skipped",
        });
        return "Digest generation is disabled. Enable it in Settings → Scheduled Jobs.";
      }
    }

    const daysBack = args.daysBack ?? DEFAULT_DAYS_BACK;
    const since = Date.now() - daysBack * 24 * 60 * 60 * 1000;

    try {
      // Query recent entries (getRecent uses "after", not "since")
      const entries: any[] = await ctx.runQuery(
        api.knowledgeEntries.getRecent,
        { after: since }
      );

      if (entries.length === 0) {
        await ctx.runMutation(internal.cronConfig.recordRun, {
          name: CRON_NAME,
          status: "success",
        });
        return "No entries found for the specified period.";
      }

      // Group and format entries for prompt
      const grouped: Record<string, any[]> = {};
      for (const entry of entries) {
        if (!grouped[entry.source]) grouped[entry.source] = [];
        grouped[entry.source].push(entry);
      }

      let entriesText = "";
      for (const [source, sourceEntries] of Object.entries(grouped)) {
        const capped = sourceEntries.slice(0, MAX_ENTRIES_PER_SOURCE);
        entriesText += `\n## Source: ${source} (${capped.length} entries)\n\n`;
        for (const entry of capped) {
          entriesText += `### ${entry.title}\n`;
          const content =
            entry.content.length > MAX_CONTENT_PER_ENTRY
              ? entry.content.slice(0, MAX_CONTENT_PER_ENTRY) + "..."
              : entry.content;
          entriesText += `${content}\n\n---\n\n`;
        }
      }

      // Call Claude API
      const anthropic = new Anthropic();
      const response = await anthropic.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 4096,
        system: buildSystemPrompt(),
        messages: [
          {
            role: "user",
            content: `Here are my knowledge entries from the past ${daysBack} days. Total: ${entries.length} entries.\n\n${entriesText}`,
          },
        ],
      });

      const textBlock = response.content.find((b) => b.type === "text");
      if (!textBlock || textBlock.type !== "text") {
        throw new Error("No text response from Claude API");
      }

      // Parse JSON
      let digest: any;
      try {
        digest = JSON.parse(textBlock.text);
      } catch {
        const match = textBlock.text.match(/\{[\s\S]*\}/);
        if (!match) throw new Error("Failed to parse Claude response as JSON");
        digest = JSON.parse(match[0]);
      }

      // Store digest
      await ctx.runMutation(api.digests.create, {
        startDate: since,
        endDate: Date.now(),
        activitySummary: digest.activitySummary,
        keyThemes: digest.keyThemes,
        contentIdeas: digest.contentIdeas,
        knowledgeGaps: digest.knowledgeGaps || [],
        notableSaves: digest.notableSaves || [],
        rawMarkdown: digest.rawMarkdown,
      });

      // Record success
      await ctx.runMutation(internal.cronConfig.recordRun, {
        name: CRON_NAME,
        status: "success",
      });

      return digest.rawMarkdown;
    } catch (err) {
      // Record error
      await ctx.runMutation(internal.cronConfig.recordRun, {
        name: CRON_NAME,
        status: "error",
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  },
});
