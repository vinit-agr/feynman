"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@backend/convex/_generated/api";
import type { Id } from "@backend/convex/_generated/dataModel";
import ReactMarkdown from "react-markdown";
import { X, ChevronDown, ChevronRight, Pencil, Sparkles, Loader2 } from "lucide-react";
import { ConversationRenderer } from "@/components/knowledge/renderers/conversation-renderer";
import { TopicSegmentationRenderer } from "@/components/knowledge/renderers/topic-segmentation-renderer";

// Renderer registry — maps rendererType to a component that handles that format
const RENDERERS: Record<string, React.ComponentType<{ data: string }>> = {
  conversation: ConversationRenderer,
};

interface SessionSlideOverProps {
  rawFile: any;
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

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function recordSummary(record: Record<string, unknown>): string {
  const type = (record.type as string) ?? "unknown";
  const role = (record.message as { role?: string })?.role ?? "";
  const ts = record.timestamp as string | undefined;
  const parts = [type];
  if (role) parts.push(role);
  if (ts) {
    const d = new Date(ts);
    if (!isNaN(d.getTime())) {
      parts.push(
        d.toLocaleString(undefined, {
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        })
      );
    }
  }
  return parts.join(" · ");
}

export function SessionSlideOver({ rawFile, onClose }: SessionSlideOverProps) {
  const extractors = useQuery(api.extractors.list, { source: rawFile.source });
  const entries = useQuery(api.knowledgeEntries.listByRawFile, {
    rawFileId: rawFile._id as Id<"rawFiles">,
  });

  const extractorList = extractors ?? [];
  const entryList = entries ?? [];

  // Live query for rawFile status (props may be a stale snapshot)
  const liveRawFile = useQuery(api.rawFiles.getByIdPublic, {
    id: rawFile._id as Id<"rawFiles">,
  });
  const currentRawFile = liveRawFile ?? rawFile;

  // Topic segmentation trigger
  const triggerTopicSegmentation = useMutation(api.rawFiles.triggerTopicSegmentation);

  // Detect topic segmentation status
  const topicSegStatus = (currentRawFile.extractionResults ?? []).find(
    (r: any) => r.extractorName === "topic-segmentation"
  );
  const isAnalyzing =
    topicSegStatus?.status === "pending" || topicSegStatus?.status === "running";
  const analysisFailed = topicSegStatus?.status === "failed";

  // View modes: extractor name or "raw"
  const [selectedView, setSelectedView] = useState<string>("");
  const [contentMode, setContentMode] = useState<"rendered" | "raw">("rendered");

  // Raw file viewing state
  const [records, setRecords] = useState<
    Array<{ index: number; summary: string; json: string }>
  >([]);
  const [rawText, setRawText] = useState("");
  const [rawLoading, setRawLoading] = useState(false);
  const [rawError, setRawError] = useState<string | null>(null);
  const [expandedRecords, setExpandedRecords] = useState<Set<number>>(new Set());

  const downloadUrl = useQuery(
    api.rawFiles.getDownloadUrl,
    rawFile.storageId
      ? { storageId: rawFile.storageId as Id<"_storage"> }
      : "skip"
  );

  // Check if topic segmentation data exists (needed before useEffect below)
  const workSummaryEntry = entryList.find(
    (e: any) => e.extractorName === "project-work-summary"
  );
  const hasTopicSegmentation = !!workSummaryEntry?.topicSegmentation;

  // Default to first extractor when data loads, or topic-summary if available
  useEffect(() => {
    if (extractorList.length > 0 && !selectedView) {
      if (hasTopicSegmentation) {
        setSelectedView("topic-summary");
      } else {
        setSelectedView(extractorList[0].name);
      }
    }
  }, [extractorList.length, hasTopicSegmentation]);

  // Fetch raw file content when "raw" view is selected
  useEffect(() => {
    if (selectedView !== "raw" || !downloadUrl) return;

    setRawLoading(true);
    setRawError(null);

    fetch(downloadUrl)
      .then((res) => res.text())
      .then((text) => {
        setRawText(text);
        const lines = text.split("\n").filter((l) => l.trim());
        const parsed = lines.map((line, i) => {
          try {
            const obj = JSON.parse(line);
            return { index: i, summary: recordSummary(obj), json: JSON.stringify(obj, null, 2) };
          } catch {
            return { index: i, summary: `Line ${i + 1} (parse error)`, json: line };
          }
        });
        setRecords(parsed);
        setRawLoading(false);
      })
      .catch((err) => {
        setRawError(err.message);
        setRawLoading(false);
      });
  }, [selectedView, downloadUrl]);

  const toggleRecord = useCallback((index: number) => {
    setExpandedRecords((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }, []);

  // Find the entry for the currently selected extractor
  const selectedEntry = selectedView !== "raw"
    ? entryList.find((e: any) => e.extractorName === selectedView)
    : null;

  // Find the extractor record for the selected view (needed for rendererType)
  const selectedExtractor = selectedView !== "raw"
    ? extractorList.find((ex: any) => ex.name === selectedView)
    : null;

  // Derive title: user-set displayName > extracted title > fileName
  const title = rawFile.displayName
    ?? (entryList.length > 0 ? entryList[0].title : rawFile.fileName);

  // Inline rename state
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState("");
  const editInputRef = useRef<HTMLInputElement>(null);
  const renameSession = useMutation(api.rawFiles.renameSession);

  function startEditing() {
    setEditValue(title);
    setIsEditing(true);
    setTimeout(() => editInputRef.current?.select(), 0);
  }

  async function commitRename() {
    setIsEditing(false);
    const trimmed = editValue.trim();
    if (!trimmed || trimmed === title) return;
    await renameSession({
      rawFileId: rawFile._id as Id<"rawFiles">,
      displayName: trimmed,
    });
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/20 z-40" onClick={onClose} />

      <div className="fixed inset-y-0 right-0 w-[600px] bg-background border-l shadow-lg z-50 flex flex-col">
        {/* Header */}
        <div className="px-5 py-4 border-b space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0 space-y-1">
              {isEditing ? (
                <input
                  ref={editInputRef}
                  autoFocus
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onBlur={commitRename}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitRename();
                    if (e.key === "Escape") setIsEditing(false);
                  }}
                  className="text-base font-semibold leading-snug w-full bg-transparent border-b-2 border-primary/40 focus:border-primary outline-none py-0.5 -mb-0.5 transition-colors"
                />
              ) : (
                <h2
                  className="text-base font-semibold leading-snug truncate group/title cursor-pointer flex items-center gap-1.5"
                  onDoubleClick={startEditing}
                  title="Double-click to rename"
                >
                  <span className="truncate">{title}</span>
                  <button
                    onClick={(e) => { e.stopPropagation(); startEditing(); }}
                    className="shrink-0 p-0.5 rounded opacity-0 group-hover/title:opacity-100 hover:bg-accent transition-all"
                  >
                    <Pencil className="h-3 w-3 text-muted-foreground" />
                  </button>
                </h2>
              )}
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                {rawFile.sessionId && (
                  <span title={rawFile.sessionId}>
                    Session: {rawFile.sessionId.slice(0, 8)}
                  </span>
                )}
                <span>{formatDate(rawFile.timestamp)}</span>
                <span>{formatBytes(rawFile.localFileSize)}</span>
              </div>
            </div>
            <button
              onClick={onClose}
              className="shrink-0 rounded-md p-1 hover:bg-accent transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* View selector */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-muted-foreground">View:</span>
            <select
              value={selectedView}
              onChange={(e) => {
                setSelectedView(e.target.value);
                setContentMode("rendered");
              }}
              className="text-sm border rounded-md px-2 py-1 bg-background min-w-[200px]"
            >
              {hasTopicSegmentation && (
                <option value="topic-summary">Topic Summary</option>
              )}
              {extractorList.map((ex: any) => (
                <option key={ex.name} value={ex.name}>
                  {ex.displayName}
                </option>
              ))}
              <option value="raw">Raw Transcript</option>
            </select>
            <button
              onClick={() =>
                triggerTopicSegmentation({
                  rawFileId: rawFile._id as Id<"rawFiles">,
                })
              }
              disabled={isAnalyzing}
              className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border transition-colors ${
                isAnalyzing
                  ? "opacity-50 cursor-not-allowed"
                  : analysisFailed
                    ? "border-destructive/50 text-destructive hover:bg-destructive/10"
                    : "hover:bg-accent"
              }`}
            >
              {isAnalyzing ? (
                <>
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Analyzing...
                </>
              ) : analysisFailed ? (
                <>
                  <Sparkles className="h-3 w-3" />
                  Retry Analysis
                </>
              ) : (
                <>
                  <Sparkles className="h-3 w-3" />
                  Analyze Topics
                </>
              )}
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {selectedView === "topic-summary" && workSummaryEntry?.topicSegmentation ? (
            <TopicSegmentationRenderer
              topicSegmentation={workSummaryEntry.topicSegmentation}
              conversationMessages={(() => {
                try {
                  return JSON.parse(workSummaryEntry.content);
                } catch {
                  return [];
                }
              })()}
            />
          ) : selectedView === "raw" ? (
            // Raw transcript view
            <>
              {!rawFile.storageId ? (
                <div className="flex items-center justify-center h-full">
                  <p className="text-sm text-muted-foreground">No content available</p>
                </div>
              ) : rawLoading ? (
                <div className="flex items-center justify-center h-full">
                  <p className="text-sm text-muted-foreground">Loading file...</p>
                </div>
              ) : rawError ? (
                <div className="flex items-center justify-center h-full">
                  <p className="text-sm text-destructive">Error: {rawError}</p>
                </div>
              ) : (
                <>
                  {/* Parsed/Raw toggle */}
                  <div className="px-5 py-2 border-b flex items-center gap-2">
                    <div className="inline-flex items-center gap-0.5 border rounded-md p-0.5">
                      <button
                        onClick={() => setContentMode("rendered")}
                        className={`px-2 py-0.5 text-xs rounded transition-colors ${
                          contentMode === "rendered"
                            ? "bg-accent font-medium"
                            : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        Parsed
                      </button>
                      <button
                        onClick={() => setContentMode("raw")}
                        className={`px-2 py-0.5 text-xs rounded transition-colors ${
                          contentMode === "raw"
                            ? "bg-accent font-medium"
                            : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        Raw
                      </button>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {records.length} records
                    </span>
                  </div>

                  {contentMode === "raw" ? (
                    <div className="px-5 py-4">
                      <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed">
                        {rawText}
                      </pre>
                    </div>
                  ) : (
                    <div>
                      {records.map((record) => (
                        <div key={record.index}>
                          <button
                            onClick={() => toggleRecord(record.index)}
                            className="w-full flex items-center gap-2 px-4 py-2 text-left hover:bg-accent/30 transition-colors border-b text-xs"
                          >
                            {expandedRecords.has(record.index) ? (
                              <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
                            ) : (
                              <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
                            )}
                            <span className="font-mono text-muted-foreground w-8 shrink-0">
                              {record.index + 1}
                            </span>
                            <span className="truncate">{record.summary}</span>
                          </button>
                          {expandedRecords.has(record.index) && (
                            <div className="px-4 py-2 bg-muted/20 border-b">
                              <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed overflow-x-auto">
                                {record.json}
                              </pre>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </>
          ) : (
            // Extractor view
            <>
              {selectedEntry ? (
                <>
                  {/* Rendered/Raw toggle */}
                  <div className="px-5 py-2 border-b">
                    <div className="inline-flex items-center gap-0.5 border rounded-md p-0.5">
                      <button
                        onClick={() => setContentMode("rendered")}
                        className={`px-2 py-0.5 text-xs rounded transition-colors ${
                          contentMode === "rendered"
                            ? "bg-accent font-medium"
                            : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        Rendered
                      </button>
                      <button
                        onClick={() => setContentMode("raw")}
                        className={`px-2 py-0.5 text-xs rounded transition-colors ${
                          contentMode === "raw"
                            ? "bg-accent font-medium"
                            : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        Raw
                      </button>
                    </div>
                  </div>

                  {contentMode === "rendered" ? (
                    (() => {
                      const Renderer = selectedExtractor?.rendererType
                        ? RENDERERS[selectedExtractor.rendererType]
                        : undefined;
                      if (Renderer) {
                        // Custom renderers handle their own padding
                        return <Renderer data={selectedEntry.content} />;
                      } else if (selectedExtractor?.rendererType) {
                        return (
                          <div className="px-5 py-8 text-center">
                            <p className="text-sm text-muted-foreground">
                              Unknown renderer: {selectedExtractor.rendererType}
                            </p>
                          </div>
                        );
                      }
                      return (
                        <div className="px-5 py-4 prose prose-sm dark:prose-invert max-w-none">
                          <ReactMarkdown>{selectedEntry.content}</ReactMarkdown>
                        </div>
                      );
                    })()
                  ) : (
                    <div className="px-5 py-4">
                      <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed">
                        {(() => {
                          try {
                            return JSON.stringify(JSON.parse(selectedEntry.content), null, 2);
                          } catch {
                            return selectedEntry.content;
                          }
                        })()}
                      </pre>
                    </div>
                  )}
                </>
              ) : (
                <div className="flex items-center justify-center h-full">
                  <p className="text-sm text-muted-foreground">
                    No extraction available for this view. The extractor may not have run yet.
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
