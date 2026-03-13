"use client";

import { DigestCard } from "@/components/dashboard/digest-card";
import { PipelineSnapshot } from "@/components/dashboard/pipeline-snapshot";
import { RecentEntries } from "@/components/dashboard/recent-entries";

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Dashboard</h1>
      <PipelineSnapshot />
      <DigestCard />
      <RecentEntries />
    </div>
  );
}
