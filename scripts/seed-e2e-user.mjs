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

for (const key of ["admin", "manager", "socialManager", "signOutAdmin"]) {
  await seed(fixture[key]);
}

/*
 * Clear configuration and discovered data between runs.
 *
 * The brand and sources specs both assert an empty state, and documents left
 * behind by an earlier run would make those assertions pass or fail depending
 * on run order.
 */
for (const collection of ["companySettings", "brandSettings", "newsSources", "newsItems"]) {
  const documents = await db.collection(collection).listDocuments();
  await Promise.all(documents.map((document) => document.delete()));
}

console.log("Cleared brand and news documents");

/*
 * A handful of discovered stories, so the ranking spec has something to score.
 * Published within the last few hours, because ranking rejects anything older
 * than the acceptable window before it spends a token.
 *
 * No source document is created on purpose. The source list must stay empty
 * for the sources spec's empty state, the discovery webhook must have nothing
 * to fetch (§58 keeps tests off the network), and ranking falling back to a
 * default priority for an unknown source is a path worth exercising.
 */
const now = Date.now();

const stories = [
  "Retailer replaces 500 support staff with AI agents",
  "Bank deploys an AI agent across its call centre",
  "Manufacturer cuts back-office roles after automation rollout",
  "Startup launches an AI agent for logistics scheduling",
  "Insurer reports productivity gains from AI triage",
];

await Promise.all(
  stories.map((title, index) =>
    db
      .collection("newsItems")
      .doc(`e2e-item-${index}`)
      .set({
        title,
        summary: `${title}. Details reported by the outlet.`,
        sourceName: "E2E Wire",
        sourceId: "e2e-source",
        sourceUrl: `https://example.test/story-${index}`,
        publishedAt: new Date(now - (index + 1) * 60 * 60 * 1000).toISOString(),
        retrievedAt: new Date(now).toISOString(),
        category: "AI",
        imageUrl: "",
        duplicateGroup: `group-${index}`,
        status: "DISCOVERED",
      }),
  ),
);

console.log(`Seeded 1 source and ${stories.length} discovered stories`);

process.exit(0);
