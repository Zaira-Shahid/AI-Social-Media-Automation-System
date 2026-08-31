import { z } from "zod";

/**
 * Brand Intelligence schema (spec §11, §31).
 *
 * Firestore enforces no schema (§32), so this is the schema. It is shared by
 * the form and the server action deliberately: two copies would drift, and
 * the drift would show up as a value the UI accepts and the database
 * rejects, or worse, the reverse.
 */

/** Fixed IDs — these are configuration, not records. See the plan, 3.1. */
export const COMPANY_SETTINGS_COLLECTION = "companySettings";
export const BRAND_SETTINGS_COLLECTION = "brandSettings";
export const SETTINGS_DOCUMENT_ID = "default";

const trimmed = (max: number) => z.string().trim().max(max);

/**
 * Colours are handed to Satori (§15), which resolves no CSS colour names and
 * has no system fallback. A name like "rebeccapurple" would be accepted here
 * and then fail much later as a broken render, so only hex is allowed.
 */
const hexColor = z
  .string()
  .trim()
  .regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, "Must be a hex colour, for example #1D4ED8");

/**
 * Fonts are stored by name. Module 08 must supply real font data to Satori,
 * which means the name has to be one the renderer will actually ship — an
 * arbitrary string would be a rendering failure deferred to later.
 */
export const SUPPORTED_FONTS = ["Inter", "Roboto", "Open Sans", "Lato", "Montserrat"] as const;

const fontName = z.enum(SUPPORTED_FONTS);

/** A list of short rules. Empty strings are dropped rather than rejected — an empty row in a form is a blank, not an error. */
const ruleList = (max: number, maxItems: number) =>
  z
    .array(z.string().trim())
    .transform((items) => items.filter((item) => item.length > 0))
    .pipe(z.array(trimmed(max)).max(maxItems));

/** Topics and hashtags are compared case-insensitively, so they are normalized on the way in. */
const tagList = (maxItems: number) =>
  z
    .array(z.string().trim())
    .transform((items) =>
      Array.from(new Set(items.map((item) => item.toLowerCase()).filter(Boolean))),
    )
    .pipe(z.array(z.string().max(60)).max(maxItems));

export const companySettingsSchema = z.object({
  name: trimmed(120).min(1, "Company name is required"),
  description: trimmed(1000),
  website: z.union([
    z.literal(""),
    z.string().trim().url("Must be a full URL, including https://"),
  ]),
  industry: trimmed(120),
});

export type CompanySettings = z.infer<typeof companySettingsSchema>;

export const logoSchema = z.object({
  url: z.string().url(),
  publicId: z.string().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

export type BrandLogo = z.infer<typeof logoSchema>;

export const brandSettingsSchema = z
  .object({
    logo: logoSchema.nullable().default(null),

    colors: z.object({
      primary: hexColor,
      secondary: hexColor,
      accent: hexColor,
      background: hexColor,
      text: hexColor,
    }),

    typography: z.object({
      headingFont: fontName,
      bodyFont: fontName,
    }),

    visualStyle: trimmed(500),
    toneOfVoice: trimmed(500),
    writingStyle: trimmed(500),
    targetAudience: trimmed(500),
    brandPositioning: trimmed(500),

    preferredTopics: tagList(40),
    topicsToAvoid: tagList(40),

    ctaStyle: trimmed(300),

    hashtagRules: z.object({
      // An upper bound exists because the platforms have one and because a
      // wall of tags reads as spam. 30 is Instagram's hard limit.
      maxHashtags: z.number().int().min(0).max(30),
      required: tagList(10),
      banned: tagList(40),
      style: trimmed(200),
    }),

    contentRules: ruleList(300, 30),
    visualRules: ruleList(300, 30),
  })
  /*
   * Business rules (§31). Each of these would otherwise reach the model as a
   * contradiction, and a model given contradictory instructions does not
   * fail — it silently picks one, which is the worst outcome to debug.
   */
  .superRefine((value, context) => {
    const conflicting = value.preferredTopics.filter((topic) =>
      value.topicsToAvoid.includes(topic),
    );

    if (conflicting.length > 0) {
      context.addIssue({
        code: "custom",
        path: ["topicsToAvoid"],
        message: `Also listed as a preferred topic: ${conflicting.join(", ")}`,
      });
    }

    const contradictoryTags = value.hashtagRules.required.filter((tag) =>
      value.hashtagRules.banned.includes(tag),
    );

    if (contradictoryTags.length > 0) {
      context.addIssue({
        code: "custom",
        path: ["hashtagRules", "banned"],
        message: `Also listed as required: ${contradictoryTags.join(", ")}`,
      });
    }

    if (value.hashtagRules.required.length > value.hashtagRules.maxHashtags) {
      context.addIssue({
        code: "custom",
        path: ["hashtagRules", "maxHashtags"],
        message: `At least ${value.hashtagRules.required.length} required to fit the required hashtags`,
      });
    }
  });

export type BrandSettings = z.infer<typeof brandSettingsSchema>;

/**
 * Defaults for a project that has not been configured yet.
 *
 * Not a fallback the rest of the system may rely on — §11 requires a real
 * profile, and later modules must refuse to generate without one. These exist
 * so the form has something to render before the first save.
 */
export const EMPTY_COMPANY_SETTINGS: CompanySettings = {
  name: "",
  description: "",
  website: "",
  industry: "",
};

export const EMPTY_BRAND_SETTINGS: BrandSettings = {
  logo: null,
  colors: {
    primary: "#1D4ED8",
    secondary: "#0F172A",
    accent: "#F59E0B",
    background: "#FFFFFF",
    text: "#0F172A",
  },
  typography: { headingFont: "Inter", bodyFont: "Inter" },
  visualStyle: "",
  toneOfVoice: "",
  writingStyle: "",
  targetAudience: "",
  brandPositioning: "",
  preferredTopics: [],
  topicsToAvoid: [],
  ctaStyle: "",
  hashtagRules: { maxHashtags: 5, required: [], banned: [], style: "" },
  contentRules: [],
  visualRules: [],
};

/**
 * Is this profile complete enough for later modules to generate from?
 *
 * §11 says all generated content must use the brand profile. A profile
 * missing its voice or audience produces generic output, so the check is
 * "usable", not merely "parses".
 */
export function isBrandConfigured(
  company: CompanySettings,
  brand: BrandSettings,
): { configured: boolean; missing: string[] } {
  const missing: string[] = [];

  if (!company.name) missing.push("Company name");
  if (!brand.toneOfVoice) missing.push("Tone of voice");
  if (!brand.targetAudience) missing.push("Target audience");
  if (!brand.logo) missing.push("Logo");

  return { configured: missing.length === 0, missing };
}
