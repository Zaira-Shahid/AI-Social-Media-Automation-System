/**
 * Provision an internal user (spec §26 — no public signup).
 *
 *   npm run provision:user -- --email a@b.com --role ADMIN --name "Full Name"
 *   npm run provision:user -- --email a@b.com --role MANAGER --password "..."
 *   npm run provision:user -- --email a@b.com --disable
 *
 * Accounts exist only because an administrator ran this. There is no signup
 * route, and there must never be one.
 *
 * Creating a user, or changing a role, is the one operation that cannot go
 * through the app itself: the first ADMIN has to exist before any admin-only
 * screen is reachable at all.
 *
 * Run against the emulators by exporting FIREBASE_AUTH_EMULATOR_HOST and
 * FIRESTORE_EMULATOR_HOST first — the Admin SDK picks both up on its own.
 *
 * Standalone plain JS for the same reason as verify-services.mjs: the app's
 * Firebase helpers are `server-only` and cannot be imported from Node.
 */
import { randomBytes } from "node:crypto";
import { parseArgs } from "node:util";

import { cert, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

const ROLES = ["ADMIN", "MANAGER", "SOCIAL_MANAGER"];

const { values } = parseArgs({
  options: {
    email: { type: "string" },
    role: { type: "string" },
    name: { type: "string" },
    password: { type: "string" },
    disable: { type: "boolean", default: false },
    enable: { type: "boolean", default: false },
  },
});

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (!values.email) fail("--email is required");
if (values.disable && values.enable) fail("--disable and --enable are mutually exclusive");
if (values.role && !ROLES.includes(values.role)) {
  fail(`--role must be one of: ${ROLES.join(", ")}`);
}

const required = [
  "FIREBASE_ADMIN_PROJECT_ID",
  "FIREBASE_ADMIN_CLIENT_EMAIL",
  "FIREBASE_ADMIN_PRIVATE_KEY",
];
const missing = required.filter((name) => !process.env[name]);
if (missing.length > 0) fail(`Missing environment variables: ${missing.join(", ")}`);

initializeApp({
  credential: cert({
    projectId: process.env.FIREBASE_ADMIN_PROJECT_ID,
    clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_ADMIN_PRIVATE_KEY.replace(/\n/g, "\n"),
  }),
  projectId: process.env.FIREBASE_ADMIN_PROJECT_ID,
});

const auth = getAuth();
const db = getFirestore();

/** Look the user up by email; create them if they do not exist yet. */
async function findOrCreate(email) {
  try {
    return { user: await auth.getUserByEmail(email), created: false, generatedPassword: null };
  } catch (error) {
    if (error.code !== "auth/user-not-found") throw error;
  }

  // A generated password is never printed unless it was generated here, and
  // it is only ever shown once. The intended flow is that the new user
  // immediately resets it by email.
  const generatedPassword = values.password ?? randomBytes(18).toString("base64url");

  const user = await auth.createUser({
    email,
    password: generatedPassword,
    displayName: values.name,
    emailVerified: false,
  });

  return { user, created: true, generatedPassword: values.password ? null : generatedPassword };
}

const { user, created, generatedPassword } = await findOrCreate(values.email);

if (!created && values.password) {
  await auth.updateUser(user.uid, { password: values.password });
}

if (!created && values.name) {
  await auth.updateUser(user.uid, { displayName: values.name });
}

if (values.disable || values.enable) {
  await auth.updateUser(user.uid, { disabled: Boolean(values.disable) });
  // Revoking matters: disabling alone leaves an existing session cookie
  // usable until it expires.
  if (values.disable) await auth.revokeRefreshTokens(user.uid);
}

/*
 * The custom claim is the authoritative role — Security Rules read it (§33)
 * and the server trusts it. The profile document below is a mirror kept for
 * display, and is never used to authorize anything.
 *
 * Claims are merged rather than replaced so a future module adding its own
 * claim does not have it silently dropped here.
 */
const existingClaims = user.customClaims ?? {};
const role = values.role ?? existingClaims.role ?? null;

if (values.role) {
  await auth.setCustomUserClaims(user.uid, { ...existingClaims, role: values.role });
  // A role change must take effect now, not at the next token refresh.
  await auth.revokeRefreshTokens(user.uid);
}

const disabled = values.disable ? true : values.enable ? false : user.disabled;

await db
  .collection("profiles")
  .doc(user.uid)
  .set(
    {
      email: values.email,
      displayName: values.name ?? user.displayName ?? null,
      role,
      status: disabled ? "DISABLED" : "ACTIVE",
      updatedAt: FieldValue.serverTimestamp(),
      ...(created ? { createdAt: FieldValue.serverTimestamp() } : {}),
    },
    { merge: true },
  );

console.log(`${created ? "Created" : "Updated"} ${values.email}`);
console.log(`  uid:    ${user.uid}`);
console.log(`  role:   ${role ?? "(none)"}`);
console.log(`  status: ${disabled ? "DISABLED" : "ACTIVE"}`);

if (generatedPassword) {
  console.log("");
  console.log(`  Temporary password: ${generatedPassword}`);
  console.log("  Shown once. Have the user sign in and reset it immediately.");
}

process.exit(0);
