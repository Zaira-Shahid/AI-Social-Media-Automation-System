import "server-only";

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import { getServerEnv } from "@/lib/env.server";

/**
 * Token encryption at rest (spec §19, §56).
 *
 * §19: tokens are never stored in plaintext, are encrypted with Node's own
 * `crypto` before they reach Firestore, and the mode must be authenticated so
 * tampering is detectable rather than silently decrypting to nonsense.
 *
 * AES-256-GCM. The key comes from `TOKEN_ENCRYPTION_KEY` — server-only, never
 * sent to the client, never given to n8n. A fresh 12-byte IV is generated per
 * encryption: reusing an IV under GCM is what breaks it, so it is never
 * derived from anything about the token.
 *
 * Nothing in this file logs a value, encrypted or not (§19, §55).
 */

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;

/** `v1.<iv>.<ciphertext>.<tag>`, all base64url. The prefix is a version tag. */
const PREFIX = "v1";

function key(): Buffer {
  // The env schema already enforces 64 hex characters, so this cannot be short.
  return Buffer.from(getServerEnv().TOKEN_ENCRYPTION_KEY, "hex");
}

/** Encrypt a token for storage. The output is safe to write to Firestore. */
export function encryptToken(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key(), iv);

  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);

  return [
    PREFIX,
    iv.toString("base64url"),
    ciphertext.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
  ].join(".");
}

/** Thrown when stored ciphertext cannot be trusted. Never carries the value. */
export class TokenDecryptionError extends Error {}

/**
 * Decrypt a stored token.
 *
 * Throws on a wrong key, a truncated record or a tampered one — GCM's tag
 * check fails and that failure is surfaced, never swallowed into an empty
 * string that would later look like "no token" (§67).
 */
export function decryptToken(stored: string): string {
  const parts = stored.split(".");

  if (parts.length !== 4 || parts[0] !== PREFIX) {
    throw new TokenDecryptionError("Stored credential is not in the expected format.");
  }

  const [, iv, ciphertext, tag] = parts;

  try {
    const decipher = createDecipheriv(ALGORITHM, key(), Buffer.from(iv, "base64url"));

    decipher.setAuthTag(Buffer.from(tag, "base64url"));

    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    // Deliberately not the original error: it can carry fragments of the
    // input, and this one is written to logs.
    throw new TokenDecryptionError(
      "Stored credential could not be decrypted. The encryption key may have changed, or the record was altered.",
    );
  }
}

/**
 * A token rendered safe to show or log (§19, §42).
 *
 * §42 says never expose access tokens and §19 says never log one. Where a
 * human needs to tell two credentials apart, this is what they get.
 */
export function tokenFingerprint(plaintext: string): string {
  return `…${plaintext.slice(-4)} (${plaintext.length} chars)`;
}
