"use client";

import { useQuery } from "convex/react";
import { api } from "@backend/convex/_generated/api";
import { CronJobCard } from "@/components/settings/cron-job-card";

export default function SettingsPage() {
  const cronConfigs = useQuery(api.cronConfig.list, {});

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Manage scheduled jobs and system configuration
        </p>
      </div>

      <div className="space-y-4">
        <h2 className="text-lg font-semibold">Scheduled Jobs</h2>
        <p className="text-sm text-muted-foreground">
          Toggle jobs on/off without redeploying. Disabled jobs will be skipped when their schedule fires.
        </p>

        {cronConfigs === undefined && (
          <p className="text-sm text-muted-foreground">Loading...</p>
        )}

        {cronConfigs && cronConfigs.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No scheduled jobs configured. Run the seed function to initialize.
          </p>
        )}

        {cronConfigs && cronConfigs.length > 0 && (
          <div className="space-y-3 max-w-2xl">
            {cronConfigs.map((config: any) => (
              <CronJobCard key={config._id} config={config} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
