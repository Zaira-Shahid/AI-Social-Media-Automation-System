/**
 * Seed the brand profile directly, bypassing the /brand form (spec §11).
 *
 *   npm run seed:brand
 *
 * For when the form itself is the obstacle rather than the data — this
 * writes `companySettings/default` and `brandSettings/default` straight
 * through the Admin SDK, but validates every field through the exact same
 * Zod schemas the form's server action uses
 * (`src/lib/brand/schema.ts`), imported directly rather than duplicated, so
 * a passing run is a real guarantee the data is well-formed, not merely "the
 * script didn't catch anything obviously wrong."
 *
 * `brand/schema.ts` itself carries no `server-only` guard (it's framework-
 * agnostic Zod), so it imports here unmodified. `brand/store.ts` and
 * `brand/logo.ts` do carry that guard and throw the moment they're loaded
 * outside Next's server runtime — same reason `provision-user.mjs` and
 * `verify-services.mjs` talk to `firebase-admin`/`cloudinary` directly
 * instead of importing the app's own wrappers.
 *
 * The logo is a generated placeholder (a simple geometric mark in the
 * brand's own colors, rendered as SVG and rasterized with the same
 * @resvg/resvg-js the app's card renderer uses) rather than left empty:
 * content generation's brand gate does not require one, but Module 08's
 * static card renderer does, and a profile "seeded" without a logo would
 * still block every card from rendering. Replace it any time from the
 * Brand screen — uploading a real file there overwrites this one in place.
 */
import { cert, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { Resvg } from "@resvg/resvg-js";
import { v2 as cloudinary } from "cloudinary";

import {
  BRAND_SETTINGS_COLLECTION,
  COMPANY_SETTINGS_COLLECTION,
  SETTINGS_DOCUMENT_ID,
  brandSettingsSchema,
  companySettingsSchema,
} from "../src/lib/brand/schema.ts";

// --- The data (as given) -----------------------------------------------

const companyInput = {
  name: "NexaTech Solutions",
  industry: "Technology & AI",
  website: "https://nexatech-solutions.example.com",
  description:
    "NexaTech Solutions helps businesses adopt AI-driven automation to streamline operations, reduce manual work, and scale efficiently.",
};

const COLORS = {
  primary: "#1E3A8A",
  secondary: "#0F172A",
  accent: "#F59E0B",
  background: "#FFFFFF",
  text: "#1E293B",
};

const brandInput = {
  logo: null, // filled in below once the placeholder is uploaded
  colors: COLORS,
  typography: { headingFont: "Montserrat", bodyFont: "Inter" },
  visualStyle: "Clean, modern, minimal — corporate blue and amber palette",
  toneOfVoice: "Professional yet approachable, confident without being salesy",
  writingStyle: "Clear, concise, benefit-focused. Short sentences. Avoid jargon unless explained.",
  targetAudience:
    "Small to mid-sized business owners and operations managers exploring AI automation",
  brandPositioning: "The practical AI automation partner — real solutions, not hype",
  preferredTopics: [
    "AI automation",
    "productivity tools",
    "business efficiency",
    "workflow optimization",
  ],
  topicsToAvoid: ["politics", "cryptocurrency", "controversial social issues"],
  ctaStyle: 'Direct and action-oriented (e.g. "Learn more", "See how it works")',
  hashtagRules: {
    maxHashtags: 5,
    required: ["AIAutomation", "BusinessTech"],
    banned: ["crypto", "NFT"],
    style: "CamelCase, no spaces",
  },
  contentRules: [
    "Never make unverifiable claims about specific results or numbers",
    "Always mention the source outlet when referencing a news story",
    "Keep captions under platform character limits",
  ],
  visualRules: [
    "Always include the company logo",
    "Use only approved brand colors",
    "Never use stock photos of people's faces",
  ],
};

// --- Validate first, write nothing until both pass ----------------------

const company = companySettingsSchema.safeParse(companyInput);
const brand = brandSettingsSchema.safeParse({ ...brandInput }); // logo re-attached after upload

function reportAndExit(label, error) {
  console.error(`${label} failed validation:`);
  for (const issue of error.issues) {
    console.error(`  - ${issue.path.join(".") || "(root)"}: ${issue.message}`);
  }
  process.exit(1);
}

if (!company.success) reportAndExit("Company settings", company.error);
if (!brand.success) reportAndExit("Brand settings", brand.error);

console.log("Both documents validated against src/lib/brand/schema.ts.");

// --- Environment -----------------------------------------------------------

const required = [
  "FIREBASE_ADMIN_PROJECT_ID",
  "FIREBASE_ADMIN_CLIENT_EMAIL",
  "FIREBASE_ADMIN_PRIVATE_KEY",
  "CLOUDINARY_CLOUD_NAME",
  "CLOUDINARY_API_KEY",
  "CLOUDINARY_API_SECRET",
];

const missing = required.filter((name) => !process.env[name]);

if (missing.length > 0) {
  console.error(`Missing environment variables: ${missing.join(", ")}`);
  process.exit(1);
}

initializeApp({
  credential: cert({
    projectId: process.env.FIREBASE_ADMIN_PROJECT_ID,
    clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_ADMIN_PRIVATE_KEY.replace(/\\n/g, "\n"),
  }),
  projectId: process.env.FIREBASE_ADMIN_PROJECT_ID,
});

const db = getFirestore(process.env.FIREBASE_DATABASE_ID ?? "(default)");

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});

// --- Placeholder logo: a simple geometric mark in the brand's own colors ---

const LOGO_SVG = `
<svg width="512" height="512" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
  <rect width="512" height="512" rx="96" fill="${COLORS.primary}"/>
  <circle cx="380" cy="132" r="26" fill="${COLORS.accent}"/>
  <path d="M132 328 L214 206 L296 328 L378 206" fill="none" stroke="${COLORS.background}"
        stroke-width="26" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="132" cy="328" r="18" fill="${COLORS.background}"/>
  <circle cx="214" cy="206" r="18" fill="${COLORS.background}"/>
  <circle cx="296" cy="328" r="18" fill="${COLORS.background}"/>
  <circle cx="378" cy="206" r="18" fill="${COLORS.background}"/>
</svg>
`.trim();

async function uploadPlaceholderLogo() {
  const png = new Resvg(LOGO_SVG, { fitTo: { mode: "width", value: 512 } }).render().asPng();
  const dataUri = `data:image/png;base64,${png.toString("base64")}`;

  const result = await cloudinary.uploader.upload(dataUri, {
    folder: "brand",
    resource_type: "image",
    public_id: "logo",
    overwrite: true,
    invalidate: true,
    transformation: [{ width: 1024, height: 1024, crop: "limit" }],
  });

  return {
    url: result.secure_url,
    publicId: result.public_id,
    width: result.width,
    height: result.height,
  };
}

// --- Write -------------------------------------------------------------

const logo = await uploadPlaceholderLogo();
console.log(`Placeholder logo uploaded: ${logo.url}`);

// Re-validate with the real logo attached — the schema's own logoSchema
// shape, not assumed.
const finalBrand = brandSettingsSchema.parse({ ...brandInput, logo });

await db
  .collection(COMPANY_SETTINGS_COLLECTION)
  .doc(SETTINGS_DOCUMENT_ID)
  .set(
    { ...company.data, updatedBy: "seed-script", updatedAt: FieldValue.serverTimestamp() },
    { merge: true },
  );

await db
  .collection(BRAND_SETTINGS_COLLECTION)
  .doc(SETTINGS_DOCUMENT_ID)
  .set(
    { ...finalBrand, updatedBy: "seed-script", updatedAt: FieldValue.serverTimestamp() },
    { merge: true },
  );

console.log("companySettings/default and brandSettings/default written.");
console.log(
  "Open /brand to confirm, and replace the placeholder logo whenever you have a real one.",
);

process.exit(0);
