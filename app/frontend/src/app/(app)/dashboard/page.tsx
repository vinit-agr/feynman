"use client";

import { useState } from "react";
import { useAction } from "convex/react";
import { api } from "@backend/convex/_generated/api";
import { DigestCard } from "@/components/dashboard/digest-card";
import { PipelineSnapshot } from "@/components/dashboard/pipeline-snapshot";
import { RecentEntries } from "@/components/dashboard/recent-entries";
import { Button } from "@/components/ui/button";

export default function DashboardPage() {
  const generateDigest = useAction(api.digestAction.generateWeekly);
  const [generating, setGenerating] = useState(false);

  async function handleGenerateDigest() {
    setGenerating(true);
    try {
      await generateDigest({ daysBack: 7, manual: true });
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <Button onClick={handleGenerateDigest} disabled={generating}>
          {generating ? "Generating..." : "Generate Digest"}
        </Button>
      </div>
      <PipelineSnapshot />
      <DigestCard />
      <RecentEntries />
    </div>
  );
}
