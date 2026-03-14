"use client";

import { useQuery } from "convex/react";
import { api } from "@backend/convex/_generated/api";
import { Badge } from "@/components/ui/badge";

interface RawFilesListProps {
  source: string;
  onFileClick?: (file: any) => void;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

type FileStatus = "uploaded" | "extracting" | "extracted" | "failed";

function statusBadgeClass(status: FileStatus): string {
  switch (status) {
    case "uploaded":
      return "bg-yellow-100 text-yellow-800 border-yellow-200";
    case "extracting":
      return "bg-blue-100 text-blue-800 border-blue-200";
    case "extracted":
      return "bg-green-100 text-green-800 border-green-200";
    case "failed":
      return "bg-red-100 text-red-800 border-red-200";
    default:
      return "bg-gray-100 text-gray-800 border-gray-200";
  }
}

export function RawFilesList({ source, onFileClick }: RawFilesListProps) {
  const files = useQuery(api.rawFiles.list, { source, limit: 100 });

  const fileList = files ?? [];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-end">
        <span className="text-xs text-muted-foreground">
          {fileList.length} {fileList.length === 1 ? "file" : "files"}
        </span>
      </div>

      {fileList.length === 0 ? (
        <div className="border rounded-lg p-6 text-center text-sm text-muted-foreground">
          No files found.
        </div>
      ) : (
        <div className="border rounded-lg divide-y">
          {fileList.map((file: any) => (
            <div
              key={file._id}
              onClick={() => onFileClick?.(file)}
              className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-accent/50 transition-colors"
            >
              <div className="flex-1 min-w-0 space-y-0.5">
                <p className="text-sm font-medium truncate">{file.fileName}</p>
                <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
                  {file.projectName && <span>{file.projectName}</span>}
                  <span>{formatBytes(file.localFileSize)}</span>
                  <span>{formatDate(file.timestamp)}</span>
                </div>
              </div>
              <span
                className={`shrink-0 inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium capitalize ${statusBadgeClass(file.status)}`}
              >
                {file.status}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
