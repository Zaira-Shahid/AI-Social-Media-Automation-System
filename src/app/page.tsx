/**
 * Module 00 placeholder.
 *
 * The real Dashboard (spec §35) is built in a later module. This exists so
 * the shell renders and the Playwright smoke test has something to assert.
 */
export default function HomePage() {
  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-semibold">AI Social Media Command Center</h1>

      <p className="mt-2 text-sm text-muted-foreground">
        Module 00 — Foundation. Application shell only; no features are implemented yet.
      </p>

      <div className="mt-6 rounded-lg border border-border p-4">
        <h2 className="text-sm font-medium">Foundation status</h2>
        <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
          <li>Next.js, TypeScript and Tailwind configured</li>
          <li>Firebase client and Admin SDKs initialized separately</li>
          <li>Firestore Security Rules baseline: default-deny</li>
          <li>Cloudinary configured for media storage</li>
          <li>Health-check endpoint available at /api/health</li>
        </ul>
      </div>
    </div>
  );
}
