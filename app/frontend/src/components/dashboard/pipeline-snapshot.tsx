"use client";

import { useQuery } from "convex/react";
import { api } from "@backend/convex/_generated/api";
import { Card } from "@/components/ui/card";

const contentStages = ["ideas", "researching", "scripting", "production", "editing", "review", "published", "archive"];
const knowledgeStages = ["ideas", "researching", "learning", "curated"];

export function PipelineSnapshot() {
  const contentItems = useQuery(api.contentPipeline.list, {});
  const knowledgeItems = useQuery(api.knowledgePipeline.list, {});

  function countByStage(items: Array<{ stage: string }> | undefined, stages: string[]) {
    const counts: Record<string, number> = {};
    for (const s of stages) counts[s] = 0;
    if (items) {
      for (const item of items) {
        if (counts[item.stage] !== undefined) counts[item.stage]++;
      }
    }
    return counts;
  }

  const contentCounts = countByStage(contentItems, contentStages);
  const knowledgeCounts = countByStage(knowledgeItems, knowledgeStages);

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card className="p-4">
        <h3 className="text-sm font-semibold mb-2">Content Pipeline</h3>
        <div className="flex flex-wrap gap-2">
          {contentStages.map((s) => (
            <div key={s} className="text-center">
              <div className="text-lg font-bold">{contentCounts[s]}</div>
              <div className="text-[10px] text-muted-foreground capitalize">{s}</div>
            </div>
          ))}
        </div>
      </Card>
      <Card className="p-4">
        <h3 className="text-sm font-semibold mb-2">Knowledge Pipeline</h3>
        <div className="flex flex-wrap gap-2">
          {knowledgeStages.map((s) => (
            <div key={s} className="text-center">
              <div className="text-lg font-bold">{knowledgeCounts[s]}</div>
              <div className="text-[10px] text-muted-foreground capitalize">{s}</div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
