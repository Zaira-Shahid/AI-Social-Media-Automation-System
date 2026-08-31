import { readFileSync } from "node:fs";

import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";

/**
 * Firestore Security Rules tests (spec §33, §58).
 *
 * Run against the emulator, never the live project. Deny cases matter as
 * much as allow cases — the baseline here is default-deny, so every one of
 * these asserts a denial.
 *
 * Requires the emulator: `npm run emulators` in another terminal, or
 * `npm run test:rules` which wraps this with `firebase emulators:exec`.
 */
let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: "demo-ai-social-media-system",
    firestore: {
      rules: readFileSync("firestore.rules", "utf8"),
      host: "127.0.0.1",
      port: 8080,
    },
  });
});

afterAll(async () => {
  await testEnv?.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
});

describe("firestore.rules baseline", () => {
  it("denies reads to an unauthenticated client", async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(db, "newsItems/any-id")));
  });

  it("denies writes from an unauthenticated client", async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(setDoc(doc(db, "newsItems/any-id"), { title: "nope" }));
  });

  it("denies reads even to an authenticated client, since nothing is opened yet", async () => {
    const db = testEnv.authenticatedContext("user-1").firestore();
    await assertFails(getDoc(doc(db, "newsItems/any-id")));
  });

  it("denies writes to platform posts, which are server-only", async () => {
    const db = testEnv.authenticatedContext("user-1", { role: "ADMIN" }).firestore();
    await assertFails(setDoc(doc(db, "platformPosts/any-id"), { status: "APPROVED" }));
  });

  it("denies an admin-claimed client from writing arbitrary collections", async () => {
    const db = testEnv.authenticatedContext("user-1", { role: "ADMIN" }).firestore();
    await assertFails(setDoc(doc(db, "anything/else"), { value: 1 }));
  });
});

describe("profiles rules", () => {
  /**
   * Profiles are seeded with rules bypassed, the way the Admin SDK writes
   * them in production. Seeding through the client path would test the seed
   * rather than the rule under test.
   */
  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, "profiles/user-1"), { email: "a@example.com", role: "SOCIAL_MANAGER" });
      await setDoc(doc(db, "profiles/user-2"), { email: "b@example.com", role: "MANAGER" });
    });
  });

  it("lets a user read their own profile", async () => {
    const db = testEnv.authenticatedContext("user-1", { role: "SOCIAL_MANAGER" }).firestore();
    await assertSucceeds(getDoc(doc(db, "profiles/user-1")));
  });

  it("denies reading another user's profile", async () => {
    const db = testEnv.authenticatedContext("user-1", { role: "SOCIAL_MANAGER" }).firestore();
    await assertFails(getDoc(doc(db, "profiles/user-2")));
  });

  it("denies a MANAGER reading another user's profile", async () => {
    const db = testEnv.authenticatedContext("user-2", { role: "MANAGER" }).firestore();
    await assertFails(getDoc(doc(db, "profiles/user-1")));
  });

  it("lets an ADMIN read any profile", async () => {
    const db = testEnv.authenticatedContext("admin-1", { role: "ADMIN" }).firestore();
    await assertSucceeds(getDoc(doc(db, "profiles/user-1")));
  });

  it("denies an unauthenticated read", async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(db, "profiles/user-1")));
  });

  it("denies a user writing their own profile, which would let them set their role", async () => {
    const db = testEnv.authenticatedContext("user-1", { role: "SOCIAL_MANAGER" }).firestore();
    await assertFails(setDoc(doc(db, "profiles/user-1"), { role: "ADMIN" }));
  });

  it("denies an ADMIN writing a profile from the client, since provisioning is server-side", async () => {
    const db = testEnv.authenticatedContext("admin-1", { role: "ADMIN" }).firestore();
    await assertFails(setDoc(doc(db, "profiles/user-2"), { role: "ADMIN" }));
  });
});

describe("auditLogs rules", () => {
  it("denies an ADMIN reading audit logs from the client", async () => {
    const db = testEnv.authenticatedContext("admin-1", { role: "ADMIN" }).firestore();
    await assertFails(getDoc(doc(db, "auditLogs/entry-1")));
  });

  it("denies writing an audit entry from the client", async () => {
    const db = testEnv.authenticatedContext("admin-1", { role: "ADMIN" }).firestore();
    await assertFails(setDoc(doc(db, "auditLogs/entry-1"), { action: "LOGIN" }));
  });

  it("denies an unauthenticated read", async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(db, "auditLogs/entry-1")));
  });
});
