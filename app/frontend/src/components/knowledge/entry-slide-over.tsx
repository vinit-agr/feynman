"use client";

import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@backend/convex/_generated/api";
import type { Id } from "@backend/convex/_generated/dataModel";
import ReactMarkdown from "react-markdown";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";

interface EntrySlideOverProps {
  entryId: string;
  onClose: () => void;
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function extractorBadgeVariant(
  extractorName: string,
): "default" | "secondary" | "outline" {
  if (extractorName === "project-work-summary") return "default";
  if (extractorName === "engineering-decisions") return "secondary";
  return "outline";
}

export function EntrySlideOver({ entryId, onClose }: EntrySlideOverProps) {
  const [viewMode, setViewMode] = useState<"rendered" | "raw">("rendered");
  const entry = useQuery(api.knowledgeEntries.getById, {
    id: entryId as Id<"knowledgeEntries">,
  });
  const createPipelineItem = useMutation(api.knowledgePipeline.create);
  const triggerExtractor = useMutation(api.rawFiles.triggerExtractor);

  async function handlePromote() {
    if (!entry) return;
    await createPipelineItem({
      stage: "ideas",
      topic: entry.title,
      description: entry.content.slice(0, 500),
      linkedEntryIds: [entry._id],
      tags: entry.tags ?? [],
    });
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/20 z-40"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="fixed inset-y-0 right-0 w-[520px] bg-background border-l shadow-lg z-50 flex flex-col">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b">
          <div className="flex-1 min-w-0 space-y-2">
            {entry ? (
              <>
                <h2 className="text-base font-semibold leading-snug">
                  {entry.title}
                </h2>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs text-muted-foreground">
                    {formatDate(entry.timestamp)}
                  </span>
                  {entry.extractorName && (
                    <Badge
                      variant={extractorBadgeVariant(entry.extractorName)}
                      className="text-[10px] capitalize"
                    >
                      {entry.extractorName.replace(/-/g, " ")}
                    </Badge>
                  )}
                  {(entry.tags ?? []).map((tag: string, i: number) => (
                    <Badge key={i} variant="outline" className="text-[10px]">
                      {tag}
                    </Badge>
                  ))}
                </div>
              </>
            ) : (
              <div className="h-5 w-48 bg-muted animate-pulse rounded" />
            )}
          </div>
          <div className="flex items-center gap-0.5 border rounded-md p-0.5 shrink-0">
            <button
              onClick={() => setViewMode("rendered")}
              className={`px-2 py-0.5 text-xs rounded transition-colors ${
                viewMode === "rendered"
                  ? "bg-accent font-medium"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Rendered
            </button>
            <button
              onClick={() => setViewMode("raw")}
              className={`px-2 py-0.5 text-xs rounded transition-colors ${
                viewMode === "raw"
                  ? "bg-accent font-medium"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Raw
            </button>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 rounded-md p-1 hover:bg-accent transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Metadata row */}
        {entry && (
          <div className="flex items-center gap-4 px-5 py-2 border-b text-xs text-muted-foreground bg-muted/30">
            {entry.metadata?.messageCount !== undefined && (
              <span>{entry.metadata.messageCount} messages</span>
            )}
            {entry.metadata?.sessionId && (
              <span title={entry.metadata.sessionId}>
                Session:{" "}
                {String(entry.metadata.sessionId).slice(0, 8)}…
              </span>
            )}
            {entry.metadata?.gitBranch && (
              <span>Branch: {entry.metadata.gitBranch}</span>
            )}
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {entry ? (
            viewMode === "rendered" ? (
              <div className="prose prose-sm dark:prose-invert max-w-none">
                <ReactMarkdown>{entry.content}</ReactMarkdown>
              </div>
            ) : (
              <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed">
                {entry.content}
              </pre>
            )
          ) : (
            <div className="space-y-2">
              {[...Array(6)].map((_, i) => (
                <div
                  key={i}
                  className="h-4 bg-muted animate-pulse rounded"
                  style={{ width: `${70 + Math.random() * 30}%` }}
                />
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t px-5 py-3 flex items-center justify-end gap-2">
          {entry?.rawFileId && (
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                await triggerExtractor({
                  rawFileId: entry.rawFileId!,
                  extractorName: "engineering-decisions",
                });
              }}
            >
              Run AI Extractor
            </Button>
          )}
          <Button size="sm" onClick={handlePromote} disabled={!entry}>
            Promote to Pipeline
          </Button>
        </div>
      </div>
    </>
  );
}
