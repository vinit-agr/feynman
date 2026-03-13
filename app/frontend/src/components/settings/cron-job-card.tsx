"use client";

import { useMutation } from "convex/react";
import { api } from "@backend/convex/_generated/api";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";

interface CronJobCardProps {
  config: {
    _id: string;
    name: string;
    description: string;
    schedule: string;
    functionName: string;
    enabled: boolean;
    lastRunAt?: number;
    lastStatus?: "success" | "error" | "skipped";
    lastError?: string;
    runCount: number;
  };
}

const statusColors: Record<string, string> = {
  success: "bg-green-500/10 text-green-500 border-green-500/20",
  error: "bg-red-500/10 text-red-500 border-red-500/20",
  skipped: "bg-yellow-500/10 text-yellow-500 border-yellow-500/20",
};

export function CronJobCard({ config }: CronJobCardProps) {
  const setEnabled = useMutation(api.cronConfig.setEnabled);

  async function handleToggle(checked: boolean) {
    await setEnabled({ name: config.name, enabled: checked });
  }

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <h3 className="text-sm font-semibold">{config.description}</h3>
          <p className="text-xs text-muted-foreground font-mono">{config.name}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {config.enabled ? "Enabled" : "Disabled"}
          </span>
          <Switch checked={config.enabled} onCheckedChange={handleToggle} />
        </div>
      </div>

      <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
        <div>
          <span className="font-medium">Schedule:</span> {config.schedule}
        </div>
        <div>
          <span className="font-medium">Total runs:</span> {config.runCount}
        </div>
      </div>

      {config.lastRunAt && (
        <div className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">Last run:</span>
          <span>{new Date(config.lastRunAt).toLocaleString()}</span>
          {config.lastStatus && (
            <Badge variant="outline" className={`text-[10px] ${statusColors[config.lastStatus] || ""}`}>
              {config.lastStatus}
            </Badge>
          )}
        </div>
      )}

      {config.lastStatus === "error" && config.lastError && (
        <div className="text-xs text-red-500 bg-red-500/5 rounded p-2 font-mono">
          {config.lastError}
        </div>
      )}

      {!config.lastRunAt && (
        <p className="text-xs text-muted-foreground italic">No runs yet</p>
      )}
    </Card>
  );
}
