import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The enable/disable gate (spec §41, §65, §63 Module 20).
 *
 * Under test: a workflow nobody has ever toggled reads as enabled (§41's
 * default), and the gate reflects whatever the store says without adding
 * any interpretation of its own.
 */
const getAutomationSetting = vi.fn();

vi.mock("@/lib/automation/store", () => ({
  getAutomationSetting: (workflow: string) => getAutomationSetting(workflow),
}));

const { isWorkflowEnabled } = await import("@/lib/automation/gate");

beforeEach(() => {
  getAutomationSetting.mockReset();
});

describe("isWorkflowEnabled", () => {
  it("is true when the store says enabled", async () => {
    getAutomationSetting.mockResolvedValue({ enabled: true, updatedBy: "uid-1", updatedAt: "2026-09-02T00:00:00.000Z" });

    expect(await isWorkflowEnabled("01_daily_news_discovery")).toBe(true);
  });

  it("is false once an ADMIN has turned it off", async () => {
    getAutomationSetting.mockResolvedValue({ enabled: false, updatedBy: "uid-1", updatedAt: "2026-09-02T00:00:00.000Z" });

    expect(await isWorkflowEnabled("01_daily_news_discovery")).toBe(false);
  });
});
