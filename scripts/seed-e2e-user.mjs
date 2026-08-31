/**
 * Seed the account used by the credentialed end-to-end run.
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

// Read the same fixture the Playwright spec imports, so the seeded account
// and the account the tests sign in as cannot drift apart.
const { email, password, role } = JSON.parse(readFileSync("tests/fixtures/e2e-user.json", "utf8"));

initializeApp({
  credential: cert({
    projectId: process.env.FIREBASE_ADMIN_PROJECT_ID,
    clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_ADMIN_PRIVATE_KEY.replace(/\n/g, "\n"),
  }),
  projectId: process.env.FIREBASE_ADMIN_PROJECT_ID,
});

const auth = getAuth();

let user;
try {
  user = await auth.getUserByEmail(email);
  await auth.updateUser(user.uid, { password });
} catch (error) {
  if (error.code !== "auth/user-not-found") throw error;
  user = await auth.createUser({ email, password, displayName: "E2E Admin" });
}

await auth.setCustomUserClaims(user.uid, { role });

await getFirestore().collection("profiles").doc(user.uid).set(
  {
    email,
    displayName: "E2E Admin",
    role,
    status: "ACTIVE",
    updatedAt: FieldValue.serverTimestamp(),
  },
  { merge: true },
);

console.log(`Seeded ${email} (${role}) in the emulator as ${user.uid}`);
process.exit(0);
