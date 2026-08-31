/**
 * Says out loud when this build is not talking to the real project (§21, §66).
 *
 * `NEXT_PUBLIC_*` values are baked in at build time, so a bundle built against
 * the Firebase emulators keeps talking to them — including to an emulator that
 * stopped running hours ago. Without a banner, that build looks exactly like
 * the real one, and every sign-in failure points at the wrong cause.
 *
 * §21 requires simulated systems to be clearly labelled and forbids the UI from
 * implying a real result. An emulator-backed build is exactly that case.
 */
export function EnvironmentBanner() {
  const emulatorHost = process.env.NEXT_PUBLIC_FIREBASE_EMULATOR_HOST;

  if (!emulatorHost) return null;

  return (
    <div
      role="status"
      data-testid="emulator-banner"
      className="bg-destructive/10 px-4 py-2 text-center text-xs font-medium text-destructive"
    >
      Emulator build — authentication and data are local to {emulatorHost}. Nothing here is real.
    </div>
  );
}
