"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@backend/convex/_generated/api";

interface SourceEntryListProps {
  source: string;
  onEntryClick: (id: string) => void;
  selectedEntryId?: string;
}

function formatFriendlyDate(timestamp: number): string {
  return new Date(timestamp).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

const datePresets = [
  { label: "Last 7 days", value: "7" },
  { label: "Last 30 days", value: "30" },
  { label: "Last 90 days", value: "90" },
  { label: "All time", value: "" },
];

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
  const [projectFilter, setProjectFilter] = useState<string>("");
  const [dateRange, setDateRange] = useState<string>("7");

  const extractors = useQuery(api.extractors.list, { source });
  const entries = useQuery(api.knowledgeEntries.listBySourceAndExtractor, {
    source,
    extractorName: filter || undefined,
    limit: 100,
  });

  const extractorList = extractors ?? [];
  const entryList = entries ?? [];

  const projectNames = Array.from(
    new Set(
      entryList
        .map((e: any) => e.metadata?.projectName as string | undefined)
        .filter(Boolean)
    )
  ).sort();

  const filteredEntries = entryList.filter((entry: any) => {
    if (projectFilter && entry.metadata?.projectName !== projectFilter) {
      return false;
    }
    if (dateRange) {
      const daysAgo = parseInt(dateRange, 10);
      const cutoff = Date.now() - daysAgo * 24 * 60 * 60 * 1000;
      if (entry.timestamp < cutoff) return false;
    }
    return true;
  });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 flex-wrap">
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

          <select
            value={projectFilter}
            onChange={(e) => setProjectFilter(e.target.value)}
            className="text-sm border rounded-md px-2 py-1 bg-background"
          >
            <option value="">All projects</option>
            {projectNames.map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>

          <select
            value={dateRange}
            onChange={(e) => setDateRange(e.target.value)}
            className="text-sm border rounded-md px-2 py-1 bg-background"
          >
            {datePresets.map((preset) => (
              <option key={preset.value} value={preset.value}>{preset.label}</option>
            ))}
          </select>
        </div>

        <span className="text-xs text-muted-foreground">
          {filteredEntries.length} {filteredEntries.length === 1 ? "entry" : "entries"}
        </span>
      </div>

      {filteredEntries.length === 0 ? (
        <div className="border rounded-lg p-6 text-center text-sm text-muted-foreground">
          No entries found.
        </div>
      ) : (
        <div className="border rounded-lg divide-y">
          {filteredEntries.map((entry: any) => (
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
                  <span>{formatFriendlyDate(entry.timestamp)}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
