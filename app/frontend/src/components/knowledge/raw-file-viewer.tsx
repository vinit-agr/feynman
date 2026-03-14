"use client";

import { useState, useEffect, useCallback } from "react";
import { useQuery } from "convex/react";
import { api } from "@backend/convex/_generated/api";
import type { Id } from "@backend/convex/_generated/dataModel";
import { Badge } from "@/components/ui/badge";
import { X, ChevronDown, ChevronRight } from "lucide-react";

interface RawFileViewerProps {
  file: {
    _id: string;
    fileName: string;
    storageId: string;
    localFileSize: number;
    timestamp: number;
    status: string;
    projectName?: string;
  };
  onClose: () => void;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Derive a one-line summary for a JSONL record */
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

export function RawFileViewer({ file, onClose }: RawFileViewerProps) {
  const downloadUrl = useQuery(api.rawFiles.getDownloadUrl, {
    storageId: file.storageId as Id<"_storage">,
  });

  const [records, setRecords] = useState<
    Array<{ index: number; summary: string; json: string; raw: Record<string, unknown> }>
  >([]);
  const [rawText, setRawText] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"parsed" | "raw">("parsed");
  const [expandedRecords, setExpandedRecords] = useState<Set<number>>(new Set());

  // Fetch and parse the file
  useEffect(() => {
    if (!downloadUrl) return;

    setLoading(true);
    setError(null);

    fetch(downloadUrl)
      .then((res) => res.text())
      .then((text) => {
        setRawText(text);
        const lines = text.split("\n").filter((l) => l.trim());
        const parsed = lines.map((line, i) => {
          try {
            const obj = JSON.parse(line);
            return {
              index: i,
              summary: recordSummary(obj),
              json: JSON.stringify(obj, null, 2),
              raw: obj,
            };
          } catch {
            return {
              index: i,
              summary: `Line ${i + 1} (parse error)`,
              json: line,
              raw: {},
            };
          }
        });
        setRecords(parsed);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, [downloadUrl]);

  const toggleRecord = useCallback((index: number) => {
    setExpandedRecords((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }, []);

  return (
    <>
      <div className="fixed inset-0 bg-black/20 z-40" onClick={onClose} />

      <div className="fixed inset-y-0 right-0 w-[600px] bg-background border-l shadow-lg z-50 flex flex-col">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b">
          <div className="flex-1 min-w-0 space-y-1">
            <h2 className="text-base font-semibold truncate">{file.fileName}</h2>
            <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
              {file.projectName && <span>{file.projectName}</span>}
              <span>{formatBytes(file.localFileSize)}</span>
              <span>{formatDate(file.timestamp)}</span>
              <Badge variant="outline" className="text-[10px] capitalize">
                {file.status}
              </Badge>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {/* View toggle */}
            <div className="flex items-center gap-0.5 border rounded-md p-0.5">
              <button
                onClick={() => setViewMode("parsed")}
                className={`px-2 py-0.5 text-xs rounded transition-colors ${
                  viewMode === "parsed"
                    ? "bg-accent font-medium"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Parsed
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
              className="rounded-md p-1 hover:bg-accent transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Record count */}
        {!loading && !error && (
          <div className="px-5 py-2 border-b text-xs text-muted-foreground bg-muted/30">
            {records.length} records
          </div>
        )}

        {/* Content */}
        {loading ? (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-sm text-muted-foreground">Loading file...</p>
          </div>
        ) : error ? (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-sm text-destructive">Error: {error}</p>
          </div>
        ) : viewMode === "raw" ? (
          <div className="flex-1 overflow-auto px-5 py-4">
            <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed">
              {rawText}
            </pre>
          </div>
        ) : (
          <div className="flex-1 overflow-auto">
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
      </div>
    </>
  );
}
