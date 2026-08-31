/**
 * The parts of the logo contract the browser needs.
 *
 * `logo.ts` is `server-only` and loads the Cloudinary SDK; the form only
 * needs the accepted types for its file input, so they live here rather than
 * being typed out a second time and drifting from what the server enforces.
 */
export const ACCEPTED_LOGO_TYPES = ["image/png", "image/svg+xml"] as const;

/** 2 MB. See the note in logo.ts for why. */
export const MAX_LOGO_BYTES = 2 * 1024 * 1024;
