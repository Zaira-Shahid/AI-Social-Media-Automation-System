import "server-only";

import { cert, getApp, getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

import { getServerEnv } from "@/lib/env.server";

const ADMIN_APP_NAME = "admin";

/**
 * Firebase Admin SDK.
 *
 * WARNING: the Admin SDK bypasses Firestore Security Rules completely
 * (spec §33). Rules do not protect anything reached through this client, so
 * every code path using it must perform its own authorization check.
 *
 * Never import this from client code — `server-only` makes that a build
 * error — and never expose its credentials to n8n (§56).
 */
function getAdminApp(): App {
  // Next.js hot reload re-evaluates modules, so re-initializing would throw
  // "app already exists". Look up the named app first.
  const existing = getApps().find((app) => app.name === ADMIN_APP_NAME);
  if (existing) return existing;

  const env = getServerEnv();

  return initializeApp(
    {
      credential: cert({
        projectId: env.FIREBASE_ADMIN_PROJECT_ID,
        clientEmail: env.FIREBASE_ADMIN_CLIENT_EMAIL,
        // Newlines are already normalized by the env schema.
        privateKey: env.FIREBASE_ADMIN_PRIVATE_KEY,
      }),
      projectId: env.FIREBASE_ADMIN_PROJECT_ID,
    },
    ADMIN_APP_NAME,
  );
}

export function getAdminFirestore(): Firestore {
  return getFirestore(getAdminApp(), getServerEnv().FIREBASE_DATABASE_ID);
}

export function getAdminAuth(): Auth {
  return getAuth(getAdminApp());
}

export { getAdminApp, getApp };
