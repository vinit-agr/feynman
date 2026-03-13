"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronUp } from "lucide-react";

interface EntryCardProps {
  entry: {
    _id: string;
    source: string;
    title: string;
    content: string;
    timestamp: number;
    tags?: string[];
    url?: string;
  };
}

export function EntryCard({ entry }: EntryCardProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <Card className="p-4 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 flex-1">
          <Badge variant="outline" className="text-xs font-mono shrink-0">
            {entry.source}
          </Badge>
          <span className="text-sm font-medium">{entry.title}</span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 shrink-0"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? (
            <ChevronUp className="h-3 w-3" />
          ) : (
            <ChevronDown className="h-3 w-3" />
          )}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        {new Date(entry.timestamp).toLocaleDateString()}
        {entry.url && (
          <>
            {" — "}
            <a
              href={entry.url}
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              source
            </a>
          </>
        )}
      </p>
      {!expanded && (
        <p className="text-sm text-muted-foreground line-clamp-3">
          {entry.content.slice(0, 300)}
          {entry.content.length > 300 ? "..." : ""}
        </p>
      )}
      {expanded && (
        <div className="text-sm whitespace-pre-wrap max-h-[500px] overflow-y-auto border rounded-md p-3 bg-muted/30">
          {entry.content}
        </div>
      )}
      {entry.tags && entry.tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {entry.tags.map((tag, i) => (
            <Badge key={i} variant="secondary" className="text-[10px]">
              {tag}
            </Badge>
          ))}
        </div>
      )}
    </Card>
  );
}
