import { z } from "zod";

/**
 * Notification logs (spec §9, §45, §52).
 *
 * Firestore enforces no schema (§32), so this is the schema. Every attempt to
 * notify is recorded — sent, failed or skipped — because §67 means the only
 * honest answer to "did Slack get today's shortlist?" is a record of what
 * actually happened, not the absence of an error.
 */
export const NOTIFICATION_LOGS_COLLECTION = "notificationLogs";

export const NEWS_SHORTLIST_WORKFLOW = "03_slack_news_notification";

/**
 * SKIPPED is a first-class outcome, not a quiet success.
 *
 * Two things produce it: an empty shortlist, and a repeat of a shortlist that
 * has already been sent. Recording it means an operator can tell "nothing to
 * say today" apart from "the notification never ran" (§52).
 */
export const notificationStatusSchema = z.enum(["SENT", "FAILED", "SKIPPED"]);

export type NotificationStatus = z.infer<typeof notificationStatusSchema>;

export const notificationLogSchema = z.object({
  workflow: z.string().min(1),
  status: notificationStatusSchema,
  /** §21/§66: whether the message really went to Slack or was simulated. */
  mode: z.enum(["REAL", "MOCK"]),
  channel: z.string().min(1),
  trigger: z.enum(["WEBHOOK", "MANUAL"]),
  storyCount: z.number().int().min(0),
  /** Which stories were announced, so a message can be traced back to them. */
  storyIds: z.array(z.string().min(1)),
  /**
   * Fingerprint of the announced shortlist.
   *
   * Lets a repeated scheduled trigger recognise that it would be sending the
   * same list again — an n8n retry should not post the shortlist twice.
   */
  dedupeKey: z.string().min(1),
  /** Slack's message timestamp when the post succeeded; null otherwise. */
  messageTs: z.string().nullable(),
  /** Why it failed or was skipped. Null on success. */
  detail: z.string().nullable(),
  sentAt: z.string().datetime(),
});

export type NotificationLog = z.infer<typeof notificationLogSchema>;
