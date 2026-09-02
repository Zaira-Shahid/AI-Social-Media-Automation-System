import { z } from "zod";

import {
  AUTOMATION_RUNS_COLLECTION,
  automationRunSchema,
  type AutomationRun,
} from "@/lib/news/schema";

/**
 * The Automation Control Center's own data (spec §41, §63 Module 20).
 *
 * `automationRunSchema` and `AUTOMATION_RUNS_COLLECTION` stay declared in
 * `news/schema.ts`, where Module 03/04 first wrote them — moving them would
 * touch `ingest.ts`, `rank.ts` and every screen that already reads
 * `sourcesAttempted`/`itemsNew` off their in-memory result for no behavioural
 * gain. This file re-exports them so every other automation has one place to
 * import the shared shape from, alongside what is genuinely new here.
 */
export { AUTOMATION_RUNS_COLLECTION, automationRunSchema };
export type { AutomationRun };

/**
 * The four fields news discovery/ranking already use, zeroed out for every
 * other workflow.
 *
 * `automationRunSchema` defaults them so an old stored run still parses, but
 * `AutomationRun` (the output type) still requires them on anything being
 * constructed fresh — spreading this into a new workflow's run is clearer
 * than typing four zeroes by hand at every call site, and says in one place
 * that they are genuinely inapplicable here, not merely forgotten.
 */
export const NO_SOURCE_METRICS = {
  sourcesAttempted: 0,
  sourcesFailed: 0,
  itemsDiscovered: 0,
  itemsNew: 0,
} as const;

export const AUTOMATION_SETTINGS_COLLECTION = "automationSettings";

export const automationSettingSchema = z.object({
  enabled: z.boolean(),
  updatedBy: z.string().min(1),
  updatedAt: z.string().datetime(),
});

export type AutomationSetting = z.infer<typeof automationSettingSchema>;

/** A workflow nobody has ever toggled reads as this — on, by default (§41). */
export const DEFAULT_AUTOMATION_SETTING: AutomationSetting = {
  enabled: true,
  updatedBy: "system",
  updatedAt: new Date(0).toISOString(),
};

/**
 * `07_scheduled_publishing` runs as two phases §41 shows as separate rows:
 * the due check at `content/due`, and the actual publish at
 * `content/publish`. Both still belong to the one n8n workflow — these are
 * this app's own internal keys for telling their two run histories and
 * enable/disable switches apart, not two n8n workflow ids.
 */
export const SCHEDULING_WORKFLOW = "07_scheduled_publishing:due";
export const PUBLISHING_WORKFLOW = "07_scheduled_publishing:publish";
export const ANALYTICS_SYNC_WORKFLOW = "08_analytics_sync";

/**
 * §41's eight rows, in its order.
 *
 * Deliberately plain data — a `workflow` string and a `label`, nothing
 * imported from the modules that actually run each one. Importing, say,
 * `content/generate.ts` here just to reuse its exported constant would pull
 * this lightweight registry into the AI/Firestore module graph of every
 * webhook route that reads it (`content/due`, `content/publish`, …), for a
 * six-character string. The literal is duplicated instead — six values that
 * rarely change — and each row names where its owning constant actually
 * lives, so the two are easy to keep in sync by inspection.
 */
export interface AutomationDefinition {
  workflow: string;
  label: string;
}

export const AUTOMATIONS: readonly AutomationDefinition[] = [
  { workflow: "01_daily_news_discovery", label: "Daily News Discovery" }, // news/ingest.ts
  { workflow: "03_slack_news_notification", label: "Slack Notification" }, // slack/schema.ts
  { workflow: "04_news_selection_processing", label: "Content Generation" }, // content/generate.ts
  { workflow: SCHEDULING_WORKFLOW, label: "Scheduling" },
  { workflow: PUBLISHING_WORKFLOW, label: "Publishing" },
  { workflow: ANALYTICS_SYNC_WORKFLOW, label: "Analytics" },
  { workflow: "09_weekly_performance_analysis", label: "Weekly Analysis" }, // reporting/weekly.ts
  { workflow: "10_strategy_optimization", label: "Strategy Optimization" }, // strategy/optimize.ts
] as const;
