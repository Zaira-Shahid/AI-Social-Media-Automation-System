/**
 * Seed the accounts used by the credentialed end-to-end run.
 *
 * Runs inside `firebase emulators:exec`, which sets FIREBASE_AUTH_EMULATOR_HOST
 * and FIRESTORE_EMULATOR_HOST for this process. Those are also the guard: the
 * script refuses to run without them, so it can never reach the live project
 * (§58).
 */
import { readFileSync } from "node:fs";

import { cert, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

if (!process.env.FIREBASE_AUTH_EMULATOR_HOST || !process.env.FIRESTORE_EMULATOR_HOST) {
  console.error("Refusing to run: emulator hosts are not set.");
  console.error("Use: npm run test:e2e:auth");
  process.exit(1);
}

// Read the same fixture the Playwright specs import, so the seeded accounts
// and the accounts the tests sign in as cannot drift apart.
const fixture = JSON.parse(readFileSync("tests/fixtures/e2e-user.json", "utf8"));

initializeApp({
  credential: cert({
    projectId: process.env.FIREBASE_ADMIN_PROJECT_ID,
    clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_ADMIN_PRIVATE_KEY.replace(/\\n/g, "\n"),
  }),
  projectId: process.env.FIREBASE_ADMIN_PROJECT_ID,
});

const auth = getAuth();
const db = getFirestore(process.env.FIREBASE_DATABASE_ID ?? "(default)");

async function seed({ email, password, role, displayName }) {
  let user;

  try {
    user = await auth.getUserByEmail(email);
    await auth.updateUser(user.uid, { password, displayName });
  } catch (error) {
    if (error.code !== "auth/user-not-found") throw error;
    user = await auth.createUser({ email, password, displayName });
  }

  await auth.setCustomUserClaims(user.uid, { role });

  await db
    .collection("profiles")
    .doc(user.uid)
    .set(
      { email, displayName, role, status: "ACTIVE", updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    );

  console.log(`Seeded ${email} (${role}) in the emulator as ${user.uid}`);
}

for (const key of ["admin", "socialManager"]) {
  await seed(fixture[key]);
}

/*
 * Clear the brand profile between runs.
 *
 * The brand spec asserts the empty state, and a profile left behind by an
 * earlier run would make that assertion pass or fail depending on run order.
 */
for (const collection of ["companySettings", "brandSettings"]) {
  const documents = await db.collection(collection).listDocuments();
  await Promise.all(documents.map((document) => document.delete()));
}

console.log("Cleared brand profile documents");

process.exit(0);
