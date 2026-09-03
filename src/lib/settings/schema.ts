import { z } from "zod";

import { roleSchema } from "@/lib/auth/roles";

/**
 * User profiles (spec §26, §27, §32).
 *
 * `profiles/{uid}` is written exclusively by `scripts/provision-user.mjs`
 * through the Admin SDK — `firestore.rules` denies every client write, and
 * there is deliberately no in-app account creation (§26: no signup route,
 * ever). This schema is read-only by construction: nothing in `src/`
 * writes to this collection.
 *
 * `role` is a mirror kept for display. The Firebase Auth custom claim is
 * what Security Rules and the server actually trust (§33) — this document
 * is never read to authorize anything.
 */
export const PROFILES_COLLECTION = "profiles";

export const profileStatusSchema = z.enum(["ACTIVE", "DISABLED"]);

export const profileSchema = z.object({
  email: z.string().email(),
  displayName: z.string().nullable(),
  // Nullable: a provisioned-but-not-yet-role-assigned account is a real,
  // if incomplete, state (see current-user.ts's own handling of it).
  role: roleSchema.nullable(),
  status: profileStatusSchema,
});

export type Profile = z.infer<typeof profileSchema>;
