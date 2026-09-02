import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The Automation Control Center's status read model (spec §41, §63 Module 20).
 *
 * Under test: Slack Notification reads from `notificationLogs`, not
 * `automationRuns`, and one workflow's read failing does not blank the other
 * seven rows.
 */
const getAutomationSetting = vi.fn();
const getLatestRun = vi.fn();
const listNotifications = vi.fn();

vi.mock("@/lib/automation/store", () => ({
  getAutomationSetting: (workflow: string) => getAutomationSetting(workflow),
  getLatestRun: (workflow: string) => getLatestRun(workflow),
}));

vi.mock("@/lib/slack/store", () => ({
  listNotifications: (workflow: string, limit: number) => listNotifications(workflow, limit),
}));

const { getAutomationStatuses } = await import("@/lib/automation/status");

const DEFAULT_SETTING = { enabled: true, updatedBy: "system", updatedAt: new Date(0).toISOString() };

beforeEach(() => {
  getAutomationSetting.mockReset().mockResolvedValue(DEFAULT_SETTING);
  getLatestRun.mockReset().mockResolvedValue(null);
  listNotifications.mockReset().mockResolvedValue([]);
});

describe("getAutomationStatuses", () => {
  it("returns exactly §41's eight rows", async () => {
    const statuses = await getAutomationStatuses();

    expect(statuses.map((s) => s.label)).toEqual([
      "Daily News Discovery",
      "Slack Notification",
      "Content Generation",
      "Scheduling",
      "Publishing",
      "Analytics",
      "Weekly Analysis",
      "Strategy Optimization",
    ]);
  });

  it("reads Slack Notification from notificationLogs, not automationRuns", async () => {
    listNotifications.mockImplementation((workflow: string) =>
      workflow === "03_slack_news_notification"
        ? Promise.resolve([
            {
              status: "SENT",
              sentAt: "2026-09-01T10:00:00.000Z",
              detail: null,
              trigger: "WEBHOOK",
            },
          ])
        : Promise.resolve([]),
    );

    const statuses = await getAutomationStatuses();
    const slack = statuses.find((s) => s.label === "Slack Notification");

    expect(slack?.lastRun).toMatchObject({ status: "SENT", trigger: "WEBHOOK" });
    expect(getLatestRun).not.toHaveBeenCalledWith("03_slack_news_notification");
  });

  it("does not blank the other rows when one workflow's read fails", async () => {
    getLatestRun.mockImplementation((workflow: string) =>
      workflow === "01_daily_news_discovery"
        ? Promise.reject(new Error("firestore down"))
        : Promise.resolve(null),
    );

    const statuses = await getAutomationStatuses();

    expect(statuses).toHaveLength(8);
    expect(statuses.find((s) => s.label === "Daily News Discovery")?.lastRun).toBeNull();
  });

  it("reflects the enabled setting per workflow", async () => {
    getAutomationSetting.mockImplementation((workflow: string) =>
      Promise.resolve(workflow === "08_analytics_sync" ? { ...DEFAULT_SETTING, enabled: false } : DEFAULT_SETTING),
    );

    const statuses = await getAutomationStatuses();

    expect(statuses.find((s) => s.label === "Analytics")?.enabled).toBe(false);
    expect(statuses.find((s) => s.label === "Publishing")?.enabled).toBe(true);
  });
});
