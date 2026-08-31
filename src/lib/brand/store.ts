import "server-only";

import { FieldValue } from "firebase-admin/firestore";

import {
  BRAND_SETTINGS_COLLECTION,
  COMPANY_SETTINGS_COLLECTION,
  EMPTY_BRAND_SETTINGS,
  EMPTY_COMPANY_SETTINGS,
  SETTINGS_DOCUMENT_ID,
  brandSettingsSchema,
  companySettingsSchema,
  type BrandSettings,
  type CompanySettings,
} from "@/lib/brand/schema";
import { getAdminFirestore } from "@/lib/firebase/admin";
import { logger } from "@/lib/logger";

/**
 * Reading and writing the single brand profile (spec §11).
 *
 * Always through the Admin SDK. `firestore.rules` allows clients to read
 * these documents but never to write them, so every mutation arrives here
 * after an authorization check has already happened (§33).
 */

function companyRef() {
  return getAdminFirestore().collection(COMPANY_SETTINGS_COLLECTION).doc(SETTINGS_DOCUMENT_ID);
}

function brandRef() {
  return getAdminFirestore().collection(BRAND_SETTINGS_COLLECTION).doc(SETTINGS_DOCUMENT_ID);
}

/**
 * Parse a stored document, falling back to defaults.
 *
 * A stored document that no longer matches the schema is logged and replaced
 * with defaults rather than thrown. The alternative is that one bad field —
 * left behind by a schema change — takes the whole brand screen down, which
 * is also the only screen that could fix it.
 */
function parseStored<T>(
  schema: { safeParse: (input: unknown) => { success: boolean; data?: T; error?: unknown } },
  data: unknown,
  fallback: T,
  label: string,
): T {
  if (!data) return fallback;

  const parsed = schema.safeParse(data);

  if (!parsed.success || parsed.data === undefined) {
    logger.warn(`Stored ${label} did not match the current schema; using defaults`, {
      issues: String(parsed.error),
    });
    return fallback;
  }

  return parsed.data;
}

export async function getCompanySettings(): Promise<CompanySettings> {
  const snapshot = await companyRef().get();
  return parseStored(
    companySettingsSchema,
    snapshot.data(),
    EMPTY_COMPANY_SETTINGS,
    "company settings",
  );
}

export async function getBrandSettings(): Promise<BrandSettings> {
  const snapshot = await brandRef().get();
  return parseStored(brandSettingsSchema, snapshot.data(), EMPTY_BRAND_SETTINGS, "brand settings");
}

/** Both documents, fetched together — every caller so far needs both. */
export async function getBrandProfile(): Promise<{
  company: CompanySettings;
  brand: BrandSettings;
}> {
  const [company, brand] = await Promise.all([getCompanySettings(), getBrandSettings()]);
  return { company, brand };
}

export async function saveCompanySettings(
  settings: CompanySettings,
  updatedBy: string,
): Promise<void> {
  await companyRef().set(
    { ...settings, updatedBy, updatedAt: FieldValue.serverTimestamp() },
    { merge: true },
  );
}

export async function saveBrandSettings(settings: BrandSettings, updatedBy: string): Promise<void> {
  await brandRef().set(
    { ...settings, updatedBy, updatedAt: FieldValue.serverTimestamp() },
    { merge: true },
  );
}

/**
 * Which top-level fields differ between two objects.
 *
 * Used for the audit entry (§55), which records field names and not values:
 * a brand profile is long free text, and storing before-and-after copies
 * would bloat the audit collection without saying more than the names do.
 */
export function changedFields(before: unknown, after: unknown): string[] {
  const previous = (before ?? {}) as Record<string, unknown>;
  const next = (after ?? {}) as Record<string, unknown>;

  const keys = new Set([...Object.keys(previous), ...Object.keys(next)]);

  return [...keys]
    .filter((key) => JSON.stringify(previous[key]) !== JSON.stringify(next[key]))
    .sort();
}
