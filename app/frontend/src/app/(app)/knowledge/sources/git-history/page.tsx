"use client";

import { Card } from "@/components/ui/card";
import { GitBranch } from "lucide-react";

export default function GitHistoryPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Git History</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Knowledge extracted from Git commit history
        </p>
      </div>

      <Card className="p-8 flex flex-col items-center gap-3 text-center">
        <GitBranch className="h-8 w-8 text-muted-foreground" />
        <div>
          <p className="font-medium">Not yet configured</p>
          <p className="text-sm text-muted-foreground mt-1">
            Git history ingestion has not been set up. Once configured, commit
            messages and diffs will be extracted and surfaced here.
          </p>
        </div>
      </Card>
    </div>
  );
}
