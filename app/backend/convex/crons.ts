import { cronJobs } from "convex/server";
import { api } from "./_generated/api";

const crons = cronJobs();

// Generate weekly digest every Friday at 23:00 UTC (~6 PM ET)
// NOTE: The action checks cronConfig.enabled before doing actual work.
// To disable, toggle in Settings → Scheduled Jobs (no redeploy needed).
crons.weekly(
  "weekly-digest",
  { dayOfWeek: "friday", hourUTC: 23, minuteUTC: 0 },
  api.digestAction.generateWeekly,
  {} // no manual flag → action will check cronConfig
);

export default crons;
