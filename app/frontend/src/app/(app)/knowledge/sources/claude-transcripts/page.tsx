"use client";

import { useState } from "react";
import { SourceEntryList } from "@/components/knowledge/source-entry-list";
import { EntrySlideOver } from "@/components/knowledge/entry-slide-over";
import { RawFilesList } from "@/components/knowledge/raw-files-list";
import { RawFileViewer } from "@/components/knowledge/raw-file-viewer";

type View = "entries" | "raw";

const SOURCE = "claude-transcripts";

export default function ClaudeTranscriptsPage() {
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<any | null>(null);
  const [view, setView] = useState<View>("entries");

  function handleViewChange(newView: View) {
    setView(newView);
    if (newView === "entries") setSelectedFile(null);
    if (newView === "raw") setSelectedEntryId(null);
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">Claude Transcripts</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Knowledge extracted from Claude conversation exports
        </p>
      </div>

      {/* View toggle */}
      <div className="inline-flex rounded-md border bg-muted p-0.5 text-sm">
        <button
          onClick={() => handleViewChange("entries")}
          className={`rounded px-3 py-1 transition-colors ${
            view === "entries"
              ? "bg-background shadow-sm font-medium"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Extracted Entries
        </button>
        <button
          onClick={() => handleViewChange("raw")}
          className={`rounded px-3 py-1 transition-colors ${
            view === "raw"
              ? "bg-background shadow-sm font-medium"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Raw Files
        </button>
      </div>

      {/* Content */}
      {view === "entries" ? (
        <SourceEntryList
          source={SOURCE}
          onEntryClick={(id) => setSelectedEntryId(id)}
          selectedEntryId={selectedEntryId ?? undefined}
        />
      ) : (
        <RawFilesList source={SOURCE} onFileClick={(file) => setSelectedFile(file)} />
      )}

      {/* Slide-overs */}
      {selectedEntryId && (
        <EntrySlideOver
          entryId={selectedEntryId}
          onClose={() => setSelectedEntryId(null)}
        />
      )}
      {selectedFile && (
        <RawFileViewer
          file={selectedFile}
          onClose={() => setSelectedFile(null)}
        />
      )}
    </div>
  );
}
