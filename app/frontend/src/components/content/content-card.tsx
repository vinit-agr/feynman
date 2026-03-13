"use client";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";

const formatColors: Record<string, string> = {
  "talking-head": "bg-blue-500/10 text-blue-500 border-blue-500/20",
  "ai-video": "bg-purple-500/10 text-purple-500 border-purple-500/20",
  blog: "bg-green-500/10 text-green-500 border-green-500/20",
  "twitter-thread": "bg-sky-500/10 text-sky-500 border-sky-500/20",
  "linkedin-post": "bg-indigo-500/10 text-indigo-500 border-indigo-500/20",
  other: "bg-gray-500/10 text-gray-500 border-gray-500/20",
};

interface ContentCardProps {
  item: {
    _id: string;
    title: string;
    format: string;
    description?: string;
    tags?: string[];
    autoPopulated?: boolean;
    createdAt: number;
  };
  onClick: (id: string) => void;
}

export function ContentCard({ item, onClick }: ContentCardProps) {
  return (
    <Card
      className="p-3 cursor-pointer hover:border-primary/50 transition-colors"
      onClick={() => onClick(item._id)}
    >
      <div className="space-y-2">
        <div className="flex items-start justify-between gap-2">
          <span className="text-sm font-medium leading-tight line-clamp-2">
            {item.title}
          </span>
          {item.autoPopulated && (
            <Badge variant="outline" className="text-[10px] shrink-0">
              auto
            </Badge>
          )}
        </div>
        <Badge
          variant="outline"
          className={`text-xs ${formatColors[item.format] || ""}`}
        >
          {item.format}
        </Badge>
        {item.tags && item.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {item.tags.slice(0, 3).map((tag, i) => (
              <Badge key={i} variant="secondary" className="text-[10px]">
                {tag}
              </Badge>
            ))}
          </div>
        )}
        <p className="text-[10px] text-muted-foreground">
          {new Date(item.createdAt).toLocaleDateString()}
        </p>
      </div>
    </Card>
  );
}
