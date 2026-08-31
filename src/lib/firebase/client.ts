import { getApp, getApps, initializeApp, type FirebaseApp } from "firebase/app";
import { connectAuthEmulator, getAuth, type Auth } from "firebase/auth";
import { connectFirestoreEmulator, getFirestore, type Firestore } from "firebase/firestore";

import { getClientEnv } from "@/lib/env.client";

/**
 * Firebase client SDK — browser-safe.
 *
 * Unlike the Admin SDK, everything reached through this client IS subject to
 * Firestore Security Rules (spec §33). That is the intended access path for
 * anything the browser touches.
 */
function getClientApp(): FirebaseApp {
  if (getApps().length > 0) return getApp();

  const env = getClientEnv();

  return initializeApp({
    apiKey: env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    messagingSenderId: env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    appId: env.NEXT_PUBLIC_FIREBASE_APP_ID,
    // No storageBucket: storage is Cloudinary, not Firebase Storage (§28).
  });
}

/**
 * Emulator host for local development and end-to-end tests.
 *
 * Unset in every deployed environment. §58 keeps tests off live services,
 * and an authentication test in particular has no business creating users in
 * the real project.
 */
const EMULATOR_HOST = process.env.NEXT_PUBLIC_FIREBASE_EMULATOR_HOST;

let firestoreInstance: Firestore | undefined;
let authInstance: Auth | undefined;

export function getClientFirestore(): Firestore {
  if (firestoreInstance) return firestoreInstance;

  firestoreInstance = getFirestore(getClientApp());

  // Connecting twice throws, hence the cached instances above.
  if (EMULATOR_HOST) connectFirestoreEmulator(firestoreInstance, EMULATOR_HOST, 8080);

  return firestoreInstance;
}

export function getClientAuth(): Auth {
  if (authInstance) return authInstance;

  authInstance = getAuth(getClientApp());

  if (EMULATOR_HOST) {
    connectAuthEmulator(authInstance, `http://${EMULATOR_HOST}:9099`, { disableWarnings: true });
  }

  return authInstance;
}

export { getClientApp };
