import { Workpool } from "@convex-dev/workpool";
import { components } from "./_generated/api";
import { v } from "convex/values";

export const extractionPool = new Workpool(components.extractionPool, {
  maxParallelism: 5,
  retryActionsByDefault: true,
  defaultRetryBehavior: {
    maxAttempts: 3,
    initialBackoffMs: 1000,
    base: 2,
  },
  logLevel: "INFO",
});

// onComplete handler — produces an internalMutation via defineOnComplete
export const handleExtractionComplete = extractionPool.defineOnComplete({
  context: v.object({
    rawFileId: v.id("rawFiles"),
    extractorName: v.string(),
  }),
  handler: async (ctx, { workId: _workId, context, result }) => {
    const { rawFileId, extractorName } = context;
    const rawFile = await ctx.db.get(rawFileId);
    if (!rawFile) return;

    const results = (rawFile.extractionResults ?? []).map((r) =>
      r.extractorName === extractorName
        ? {
            extractorName,
            status:
              result.kind === "success"
                ? ("completed" as const)
                : ("failed" as const),
            entryCount:
              result.kind === "success"
                ? ((result.returnValue as { entryCount?: number })?.entryCount ?? 0)
                : 0,
            error: result.kind === "failed" ? result.error : undefined,
          }
        : r
    );

    const allDone = results.every(
      (r) => r.status === "completed" || r.status === "failed"
    );
    const anyFailed = results.some((r) => r.status === "failed");

    await ctx.db.patch(rawFileId, {
      extractionResults: results,
      ...(allDone
        ? { status: anyFailed ? ("failed" as const) : ("extracted" as const) }
        : {}),
    });
  },
});
