"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@backend/convex/_generated/api";

interface SourceEntryListProps {
  source: string;
  onEntryClick: (id: string) => void;
  selectedEntryId?: string;
}

function formatRelativeDate(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

function extractorDotColor(extractorName: string): string {
  if (extractorName === "project-work-summary") return "bg-blue-500";
  if (extractorName === "engineering-decisions") return "bg-amber-500";
  return "bg-gray-400";
}

export function SourceEntryList({
  source,
  onEntryClick,
  selectedEntryId,
}: SourceEntryListProps) {
  const [filter, setFilter] = useState<string>("");

  const extractors = useQuery(api.extractors.list, { source });
  const entries = useQuery(api.knowledgeEntries.listBySourceAndExtractor, {
    source,
    extractorName: filter || undefined,
    limit: 100,
  });

  const extractorList = extractors ?? [];
  const entryList = entries ?? [];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="text-sm border rounded-md px-2 py-1 bg-background"
        >
          <option value="">All extractors</option>
          {extractorList.map((ex: any) => (
            <option key={ex.name} value={ex.name}>
              {ex.displayName}
            </option>
          ))}
        </select>
        <span className="text-xs text-muted-foreground">
          {entryList.length} {entryList.length === 1 ? "entry" : "entries"}
        </span>
      </div>

      {entryList.length === 0 ? (
        <div className="border rounded-lg p-6 text-center text-sm text-muted-foreground">
          No entries found.
        </div>
      ) : (
        <div className="border rounded-lg divide-y">
          {entryList.map((entry: any) => (
            <div
              key={entry._id}
              onClick={() => onEntryClick(entry._id)}
              className={`flex items-start gap-3 px-4 py-3 cursor-pointer hover:bg-accent/50 transition-colors ${
                selectedEntryId === entry._id ? "bg-accent" : ""
              }`}
            >
              <span
                className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${extractorDotColor(entry.extractorName ?? "")}`}
              />
              <div className="flex-1 min-w-0 space-y-0.5">
                <p className="text-sm font-medium truncate">{entry.title}</p>
                <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
                  {entry.metadata?.projectName && (
                    <span>{entry.metadata.projectName}</span>
                  )}
                  {entry.extractorName && (
                    <span className="capitalize">
                      {entry.extractorName.replace(/-/g, " ")}
                    </span>
                  )}
                  {entry.metadata?.messageCount !== undefined && (
                    <span>{entry.metadata.messageCount} msgs</span>
                  )}
                  <span>{formatRelativeDate(entry.timestamp)}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
