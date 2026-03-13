"use client";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";

interface KnowledgeCardProps {
  item: {
    _id: string;
    topic: string;
    description?: string;
    tags?: string[];
    linkedEntryIds?: string[];
    createdAt: number;
  };
  onClick: (id: string) => void;
}

export function KnowledgeCard({ item, onClick }: KnowledgeCardProps) {
  return (
    <Card
      className="p-3 cursor-pointer hover:border-primary/50 transition-colors"
      onClick={() => onClick(item._id)}
    >
      <div className="space-y-2">
        <span className="text-sm font-medium leading-tight line-clamp-2">
          {item.topic}
        </span>
        {item.description && (
          <p className="text-xs text-muted-foreground line-clamp-2">
            {item.description}
          </p>
        )}
        {item.tags && item.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {item.tags.slice(0, 3).map((tag, i) => (
              <Badge key={i} variant="secondary" className="text-[10px]">
                {tag}
              </Badge>
            ))}
          </div>
        )}
        {item.linkedEntryIds && item.linkedEntryIds.length > 0 && (
          <p className="text-[10px] text-muted-foreground">
            {item.linkedEntryIds.length} linked entries
          </p>
        )}
      </div>
    </Card>
  );
}
