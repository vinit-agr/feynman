"use client";

import { useQuery } from "convex/react";
import { api } from "@backend/convex/_generated/api";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export function RecentEntries() {
  const entries = useQuery(api.knowledgeEntries.list, { limit: 10 });

  if (entries === undefined) {
    return <Card className="p-4"><p className="text-sm text-muted-foreground">Loading...</p></Card>;
  }

  if (entries.length === 0) {
    return (
      <Card className="p-4">
        <p className="text-sm text-muted-foreground">No knowledge entries yet. Run an ingestion script to get started.</p>
      </Card>
    );
  }

  return (
    <Card className="p-4 space-y-3">
      <h3 className="text-sm font-semibold">Recent Entries</h3>
      {entries.map((entry: { _id: string; source: string; title: string; timestamp: number }) => (
        <div key={entry._id} className="flex items-start gap-2 py-1 border-b last:border-0">
          <Badge variant="outline" className="text-[10px] font-mono shrink-0 mt-0.5">{entry.source}</Badge>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{entry.title}</p>
            <p className="text-xs text-muted-foreground">{new Date(entry.timestamp).toLocaleDateString()}</p>
          </div>
        </div>
      ))}
    </Card>
  );
}
