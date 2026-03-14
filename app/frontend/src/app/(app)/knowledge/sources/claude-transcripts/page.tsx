"use client";

import { useState } from "react";
import { SessionList } from "@/components/knowledge/session-list";
import { SessionSlideOver } from "@/components/knowledge/session-slide-over";

const SOURCE = "claude-transcripts";

export default function ClaudeTranscriptsPage() {
  const [selectedFile, setSelectedFile] = useState<any | null>(null);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">Claude Transcripts</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Transcript sessions organized by project
        </p>
      </div>

      {/* Session list */}
      <SessionList
        source={SOURCE}
        onSessionClick={(file) => setSelectedFile(file)}
        selectedSessionId={selectedFile?._id}
      />

      {/* Slide-over */}
      {selectedFile && (
        <SessionSlideOver
          rawFile={selectedFile}
          onClose={() => setSelectedFile(null)}
        />
      )}
    </div>
  );
}
