import "server-only";

import { getAdminFirestore } from "@/lib/firebase/admin";
import { logger } from "@/lib/logger";
import { PROFILES_COLLECTION, profileSchema, type Profile } from "@/lib/settings/schema";

/**
 * Reading provisioned accounts for the Settings screen (spec §26, §32, §33).
 *
 * Admin SDK only, same posture as every other cross-user read in this
 * codebase — `firestore.rules` technically permits an ADMIN-claimed client
 * to read any one profile individually, but a full collection listing goes
 * through the server, consistent with how `socialAccounts` and
 * `automationRuns` are read.
 */
export interface StoredProfile extends Profile {
  uid: string;
  /** ISO, or null if the field is missing or predates it. */
  createdAt: string | null;
  updatedAt: string | null;
}

/**
 * `createdAt`/`updatedAt` are `FieldValue.serverTimestamp()` writes
 * (`provision-user.mjs`) — a Firestore `Timestamp` on read, not a string.
 * Every other store in this codebase treats that field as write-only
 * bookkeeping and keeps a separate explicit ISO field for anything it
 * actually displays; here, "when was this account touched" *is* the one
 * thing worth showing, so it's converted directly instead.
 */
function toIsoOrNull(value: unknown): string | null {
  if (value && typeof value === "object" && "toDate" in value) {
    const toDate = (value as { toDate: () => Date }).toDate;
    if (typeof toDate === "function") return toDate.call(value).toISOString();
  }
  return null;
}

/** Every provisioned account, alphabetical by email. */
export async function listUserProfiles(): Promise<StoredProfile[]> {
  const snapshot = await getAdminFirestore().collection(PROFILES_COLLECTION).get();

  return snapshot.docs
    .map((document) => {
      const data = document.data();
      const parsed = profileSchema.safeParse(data);

      if (!parsed.success) {
        logger.warn("Stored profile did not match the schema; skipping", { uid: document.id });
        return null;
      }

      return {
        uid: document.id,
        ...parsed.data,
        createdAt: toIsoOrNull(data.createdAt),
        updatedAt: toIsoOrNull(data.updatedAt),
      };
    })
    .filter((profile): profile is StoredProfile => profile !== null)
    .sort((a, b) => a.email.localeCompare(b.email));
}
