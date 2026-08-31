"use server";

import { revalidatePath } from "next/cache";

import { recordAudit } from "@/lib/audit";
import { requirePermission } from "@/lib/auth/current-user";
import { uploadLogo } from "@/lib/brand/logo";
import {
  brandSettingsSchema,
  companySettingsSchema,
  type BrandLogo,
  type BrandSettings,
  type CompanySettings,
} from "@/lib/brand/schema";
import {
  changedFields,
  getBrandProfile,
  saveBrandSettings,
  saveCompanySettings,
} from "@/lib/brand/store";
import { logger } from "@/lib/logger";

/**
 * Saving the brand profile (spec §11, §43).
 *
 * A server action rather than a route handler: nothing here is called from
 * client-side JavaScript, so the authorization check, the validation and the
 * write all live in one place, and the multipart logo upload needs no second
 * mechanism.
 *
 * §33 requires this check regardless of Security Rules, because the Admin SDK
 * bypasses them entirely.
 */
export interface BrandFormState {
  status: "idle" | "success" | "error";
  message?: string;
  /** Dotted field path -> message, so the form can put errors next to inputs. */
  fieldErrors?: Record<string, string>;
}

/** Comma-separated input: topics, hashtags. */
function parseTags(value: FormDataEntryValue | null): string[] {
  return String(value ?? "")
    .split(",")
    .map((item) => item.trim().replace(/^#/, ""))
    .filter(Boolean);
}

/** One rule per line, which is how people actually write lists of rules. */
function parseLines(value: FormDataEntryValue | null): string[] {
  return String(value ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function text(form: FormData, name: string): string {
  return String(form.get(name) ?? "").trim();
}

/** Flatten Zod issues into the dotted paths the form inputs are named with. */
function toFieldErrors(issues: { path: PropertyKey[]; message: string }[]): Record<string, string> {
  const errors: Record<string, string> = {};

  for (const issue of issues) {
    const key = issue.path.map(String).join(".") || "form";
    // First message per field wins; a field with three complaints only has
    // room to show one.
    errors[key] ??= issue.message;
  }

  return errors;
}

export async function saveBrandProfile(
  _previous: BrandFormState,
  form: FormData,
): Promise<BrandFormState> {
  const user = await requirePermission("brand:manage");

  const existing = await getBrandProfile();

  const companyInput = {
    name: text(form, "name"),
    description: text(form, "description"),
    website: text(form, "website"),
    industry: text(form, "industry"),
  };

  const brandInput = {
    // Carried forward here; the upload below may replace it.
    logo: existing.brand.logo,
    colors: {
      primary: text(form, "colors.primary"),
      secondary: text(form, "colors.secondary"),
      accent: text(form, "colors.accent"),
      background: text(form, "colors.background"),
      text: text(form, "colors.text"),
    },
    typography: {
      headingFont: text(form, "typography.headingFont"),
      bodyFont: text(form, "typography.bodyFont"),
    },
    visualStyle: text(form, "visualStyle"),
    toneOfVoice: text(form, "toneOfVoice"),
    writingStyle: text(form, "writingStyle"),
    targetAudience: text(form, "targetAudience"),
    brandPositioning: text(form, "brandPositioning"),
    preferredTopics: parseTags(form.get("preferredTopics")),
    topicsToAvoid: parseTags(form.get("topicsToAvoid")),
    ctaStyle: text(form, "ctaStyle"),
    hashtagRules: {
      maxHashtags: Number(text(form, "hashtagRules.maxHashtags") || "0"),
      required: parseTags(form.get("hashtagRules.required")),
      banned: parseTags(form.get("hashtagRules.banned")),
      style: text(form, "hashtagRules.style"),
    },
    contentRules: parseLines(form.get("contentRules")),
    visualRules: parseLines(form.get("visualRules")),
  };

  const company = companySettingsSchema.safeParse(companyInput);
  const brand = brandSettingsSchema.safeParse(brandInput);

  if (!company.success || !brand.success) {
    return {
      status: "error",
      message: "Some fields need attention.",
      fieldErrors: {
        ...toFieldErrors(company.success ? [] : company.error.issues),
        ...toFieldErrors(brand.success ? [] : brand.error.issues),
      },
    };
  }

  /*
   * The logo is handled after validation, not before: uploading an asset and
   * then rejecting the form would leave a file in Cloudinary that nothing
   * references, burning credits for nothing (§28).
   */
  let logo: BrandLogo | null = brand.data.logo;
  const file = form.get("logo");

  if (file instanceof File && file.size > 0) {
    const upload = await uploadLogo(file, existing.brand.logo?.publicId ?? null);

    if (!upload.ok) {
      return { status: "error", message: upload.error, fieldErrors: { logo: upload.error } };
    }

    logo = upload.logo;
  }

  const nextCompany: CompanySettings = company.data;
  const nextBrand: BrandSettings = { ...brand.data, logo };

  try {
    await Promise.all([
      saveCompanySettings(nextCompany, user.uid),
      saveBrandSettings(nextBrand, user.uid),
    ]);
  } catch (error) {
    logger.error("Failed to save the brand profile", {
      error: error instanceof Error ? error.message : String(error),
    });

    return { status: "error", message: "Could not save. Please try again." };
  }

  const changed = [
    ...changedFields(existing.company, nextCompany).map((field) => `company.${field}`),
    ...changedFields(existing.brand, nextBrand).map((field) => `brand.${field}`),
  ];

  await recordAudit({
    actor: user.uid,
    action: "SETTINGS_CHANGED",
    resource: "brandSettings/default",
    status: "SUCCESS",
    // Field names only — see the note in store.ts.
    metadata: { changed },
  });

  revalidatePath("/brand");

  return {
    status: "success",
    message: changed.length > 0 ? "Brand profile saved." : "No changes to save.",
  };
}
