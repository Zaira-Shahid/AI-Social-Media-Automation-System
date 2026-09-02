import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The Automation Control Center's status read model (spec §41, §63 Module
 * 20/21).
 *
 * Under test: Slack Notification reads from `notificationLogs`, not
 * `automationRuns`; the most recent run becomes `lastRun` and the rest
 * become `recentRuns` (run history, §63 Module 21); and one workflow's read
 * failing does not blank the other seven rows.
 */
const getAutomationSetting = vi.fn();
const listRecentRuns = vi.fn();
const listNotifications = vi.fn();

vi.mock("@/lib/automation/store", () => ({
  getAutomationSetting: (workflow: string) => getAutomationSetting(workflow),
  listRecentRuns: (workflow: string, limit: number) => listRecentRuns(workflow, limit),
}));

vi.mock("@/lib/slack/store", () => ({
  listNotifications: (workflow: string, limit: number) => listNotifications(workflow, limit),
}));

const { getAutomationStatuses } = await import("@/lib/automation/status");

const DEFAULT_SETTING = { enabled: true, updatedBy: "system", updatedAt: new Date(0).toISOString() };

beforeEach(() => {
  getAutomationSetting.mockReset().mockResolvedValue(DEFAULT_SETTING);
  listRecentRuns.mockReset().mockResolvedValue([]);
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
            { status: "SENT", sentAt: "2026-09-01T10:00:00.000Z", detail: null, trigger: "WEBHOOK" },
          ])
        : Promise.resolve([]),
    );

    const statuses = await getAutomationStatuses();
    const slack = statuses.find((s) => s.label === "Slack Notification");

    expect(slack?.lastRun).toMatchObject({ status: "SENT", trigger: "WEBHOOK" });
    expect(listRecentRuns).not.toHaveBeenCalledWith("03_slack_news_notification", expect.anything());
  });

  it("splits the newest run into lastRun and the rest into recentRuns", async () => {
    listRecentRuns.mockImplementation((workflow: string) =>
      workflow === "01_daily_news_discovery"
        ? Promise.resolve([
            { workflow, status: "SUCCESS", startedAt: "t3", finishedAt: "t3", error: null, trigger: "WEBHOOK" },
            { workflow, status: "FAILURE", startedAt: "t2", finishedAt: "t2", error: "boom", trigger: "WEBHOOK" },
            { workflow, status: "SUCCESS", startedAt: "t1", finishedAt: "t1", error: null, trigger: "WEBHOOK" },
          ])
        : Promise.resolve([]),
    );

    const statuses = await getAutomationStatuses();
    const discovery = statuses.find((s) => s.label === "Daily News Discovery");

    expect(discovery?.lastRun).toMatchObject({ status: "SUCCESS", startedAt: "t3" });
    expect(discovery?.recentRuns).toHaveLength(2);
    expect(discovery?.recentRuns[0]).toMatchObject({ status: "FAILURE", startedAt: "t2" });
  });

  it("does not blank the other rows when one workflow's read fails", async () => {
    listRecentRuns.mockImplementation((workflow: string) =>
      workflow === "01_daily_news_discovery" ? Promise.reject(new Error("firestore down")) : Promise.resolve([]),
    );

    const statuses = await getAutomationStatuses();

    expect(statuses).toHaveLength(8);
    const discovery = statuses.find((s) => s.label === "Daily News Discovery");
    expect(discovery?.lastRun).toBeNull();
    expect(discovery?.recentRuns).toEqual([]);
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
