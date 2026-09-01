import { afterEach, describe, expect, it, vi } from "vitest";

import { SlackWebApiNotifier } from "@/lib/slack/api";
import { MockSlackNotifier } from "@/lib/slack/mock";

/**
 * The Slack adapter (spec §9, §21, §52, §67).
 *
 * The behaviour worth pinning is the one that is easy to get wrong and
 * catastrophic when it is: Slack answers HTTP 200 for refusals, so an adapter
 * that trusts the status code reports messages as delivered that were never
 * posted.
 */
const MESSAGE = { text: "shortlist", blocks: [{ type: "divider" }] };

function response(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("SlackWebApiNotifier", () => {
  it("posts to chat.postMessage with the bot token and returns the message timestamp", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(response({ ok: true, channel: "C123", ts: "1503435956.000247" }));

    const result = await new SlackWebApiNotifier("xoxb-test").post("C123", MESSAGE);

    expect(result).toEqual({ mode: "REAL", channel: "C123", ts: "1503435956.000247" });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://slack.com/api/chat.postMessage");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer xoxb-test");

    const body = JSON.parse(init.body as string);
    expect(body.channel).toBe("C123");
    // Fallback text travels with the blocks; without it Slack answers no_text.
    expect(body.text).toBe("shortlist");
  });

  it("treats ok:false as a failure even though the HTTP status is 200 (§67)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      response({ ok: false, error: "not_in_channel" }),
    );

    await expect(new SlackWebApiNotifier("xoxb-test").post("C123", MESSAGE)).rejects.toThrow(
      /not a member of that channel/i,
    );
  });

  it("explains a bad channel id in terms of the setting that is wrong", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      response({ ok: false, error: "channel_not_found" }),
    );

    await expect(new SlackWebApiNotifier("xoxb-test").post("C123", MESSAGE)).rejects.toThrow(
      /SLACK_NEWS_CHANNEL_ID/,
    );
  });

  it("passes an unrecognised Slack error code through rather than flattening it", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      response({ ok: false, error: "some_new_slack_error" }),
    );

    await expect(new SlackWebApiNotifier("xoxb-test").post("C123", MESSAGE)).rejects.toThrow(
      /some_new_slack_error/,
    );
  });

  it("retries once after a 429, honouring Retry-After", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        response(
          { ok: false, error: "ratelimited" },
          {
            status: 429,
            headers: { "retry-after": "1" },
          },
        ),
      )
      .mockResolvedValueOnce(response({ ok: true, channel: "C123", ts: "1.1" }));

    const result = await new SlackWebApiNotifier("xoxb-test").post("C123", MESSAGE);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.ts).toBe("1.1");
  });

  it("gives up rather than holding the request open for a long Retry-After", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      response(
        { ok: false, error: "ratelimited" },
        {
          status: 429,
          headers: { "retry-after": "600" },
        },
      ),
    );

    await expect(new SlackWebApiNotifier("xoxb-test").post("C123", MESSAGE)).rejects.toThrow(
      /rate limit/i,
    );
  });

  it("fails when Slack accepts the message but returns no timestamp", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(response({ ok: true, channel: "C123" }));

    await expect(new SlackWebApiNotifier("xoxb-test").post("C123", MESSAGE)).rejects.toThrow(
      /no timestamp/i,
    );
  });
});

describe("MockSlackNotifier", () => {
  it("reports MOCK, so nothing downstream can mistake it for a delivery (§21)", async () => {
    const result = await new MockSlackNotifier().post("#mock-news", MESSAGE);
    expect(result.mode).toBe("MOCK");
  });

  it("never touches the network", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    await new MockSlackNotifier().post("#mock-news", MESSAGE);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("is deterministic, so the suite does not flake", async () => {
    const first = await new MockSlackNotifier().post("#mock-news", MESSAGE);
    const second = await new MockSlackNotifier().post("#mock-news", MESSAGE);

    expect(first.ts).toBe(second.ts);
    // Shaped so it can never be mistaken for a real Slack timestamp.
    expect(first.ts).toMatch(/^MOCK\./);
  });
});
