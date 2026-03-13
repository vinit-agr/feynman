"use client";

import { useQuery } from "convex/react";
import { api } from "@backend/convex/_generated/api";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export function DigestCard() {
  const digest = useQuery(api.digests.getLatest);

  if (digest === undefined) {
    return <Card className="p-6"><p className="text-sm text-muted-foreground">Loading digest...</p></Card>;
  }

  if (digest === null) {
    return (
      <Card className="p-6">
        <p className="text-sm text-muted-foreground">
          No digest yet. Generate your first one using the button above.
        </p>
      </Card>
    );
  }

  return (
    <Card className="p-6 space-y-4">
      <div>
        <h3 className="text-lg font-semibold">Latest Digest</h3>
        <p className="text-xs text-muted-foreground">
          {new Date(digest.startDate).toLocaleDateString()} — {new Date(digest.endDate).toLocaleDateString()}
        </p>
      </div>

      <div>
        <h4 className="text-sm font-semibold mb-1">Activity Summary</h4>
        <p className="text-sm text-muted-foreground whitespace-pre-wrap">{digest.activitySummary}</p>
      </div>

      {digest.keyThemes && digest.keyThemes.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold mb-1">Key Themes</h4>
          <div className="flex flex-wrap gap-1">
            {digest.keyThemes.map((theme: string, i: number) => (
              <Badge key={i} variant="secondary">{theme}</Badge>
            ))}
          </div>
        </div>
      )}

      {digest.contentIdeas && digest.contentIdeas.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold mb-1">Content Ideas</h4>
          <ul className="space-y-2">
            {digest.contentIdeas.map((idea: { title: string; format: string; reasoning: string }, i: number) => (
              <li key={i} className="text-sm">
                <span className="font-medium">{idea.title}</span>
                <Badge variant="outline" className="ml-2 text-xs">{idea.format}</Badge>
                <p className="text-xs text-muted-foreground mt-0.5">{idea.reasoning}</p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {digest.knowledgeGaps && digest.knowledgeGaps.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold mb-1">Knowledge Gaps</h4>
          <ul className="list-disc list-inside text-sm text-muted-foreground">
            {digest.knowledgeGaps.map((gap: string, i: number) => (
              <li key={i}>{gap}</li>
            ))}
          </ul>
        </div>
      )}

      {digest.notableSaves && digest.notableSaves.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold mb-1">Notable Saves</h4>
          <ul className="list-disc list-inside text-sm text-muted-foreground">
            {digest.notableSaves.map((save: string, i: number) => (
              <li key={i}>{save}</li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
