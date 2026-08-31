/**
 * One-off setup verification for Module 00 (spec §64 Step 5).
 *
 *   npm run verify:services
 *
 * Confirms that the credentials in `.env.local` actually reach Firestore and
 * Cloudinary. This is deliberately NOT part of `npm run verify`: that gate
 * must stay offline and credential-free so it runs in CI, and it must never
 * be wired into /api/health, which is forbidden from making external calls
 * (§28).
 *
 * Standalone on purpose. The app's own helpers (`src/lib/firebase/admin.ts`,
 * `src/lib/cloudinary.ts`) are marked `server-only`, which is unimportable
 * from a plain Node script. What is being verified here is the contents of
 * the environment, not the app wiring — the test suite covers the wiring.
 *
 * Prints only pass/fail and error messages. Never a credential value (§55).
 */
import { cert, deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { v2 as cloudinary } from "cloudinary";

const REQUIRED = [
  "FIREBASE_ADMIN_PROJECT_ID",
  "FIREBASE_ADMIN_CLIENT_EMAIL",
  "FIREBASE_ADMIN_PRIVATE_KEY",
  "CLOUDINARY_CLOUD_NAME",
  "CLOUDINARY_API_KEY",
  "CLOUDINARY_API_SECRET",
];

const missing = REQUIRED.filter((name) => !process.env[name]);
if (missing.length > 0) {
  console.error(`Missing environment variables: ${missing.join(", ")}`);
  console.error("Run with: node --env-file=.env.local scripts/verify-services.mjs");
  process.exit(1);
}

/** Round-trip a throwaway document, then remove it. No product collection is touched. */
async function checkFirestore() {
  const app = initializeApp(
    {
      credential: cert({
        projectId: process.env.FIREBASE_ADMIN_PROJECT_ID,
        clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
        // .env carries literal backslash-n rather than real newlines.
        privateKey: process.env.FIREBASE_ADMIN_PRIVATE_KEY.replace(/\n/g, "\n"),
      }),
      projectId: process.env.FIREBASE_ADMIN_PROJECT_ID,
    },
    `verify-${Date.now()}`,
  );

  try {
    const ref = getFirestore(app).collection("_healthcheck").doc("module-00");
    await ref.set({ checkedAt: new Date().toISOString() });
    const snapshot = await ref.get();
    if (!snapshot.exists) throw new Error("document written but not readable");
    await ref.delete();
  } finally {
    await deleteApp(app);
  }
}

async function checkCloudinary() {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true,
  });

  await cloudinary.api.ping();
}

const checks = [
  ["Firestore (Admin SDK write/read/delete)", checkFirestore],
  ["Cloudinary (credentials ping)", checkCloudinary],
];

let failed = false;

for (const [label, run] of checks) {
  try {
    await run();
    console.log(`PASS  ${label}`);
  } catch (error) {
    failed = true;
    console.error(`FAIL  ${label}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

process.exit(failed ? 1 : 0);
