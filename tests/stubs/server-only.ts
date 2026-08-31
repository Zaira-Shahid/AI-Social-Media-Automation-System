/**
 * Test stub for the `server-only` package.
 *
 * The real package intentionally throws when imported outside a React Server
 * Component. Vitest is neither, so importing a server module under test would
 * fail for the wrong reason.
 *
 * This only affects tests. The genuine import guard still applies in the
 * Next.js build, which is where it actually protects anything.
 */
export {};
