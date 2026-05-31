// M3 — install(): the one public entry. Wires normalize (M1) + sink (M2) onto the
// global error net and returns capture(). This is glue: the behavior it composes
// is tested in M1/M2; here we test the wiring and the crash policy (PRD §7).
import { normalize } from './normalize.js';
import { sink } from './sink.js';

/** @typedef {import('./types.js').InstallOptions} InstallOptions */

// flightlog's currently-registered global handlers. Tracked at module scope so a
// repeated install() *replaces* them (last call wins) instead of stacking a second
// pair — which would log every error twice and leak process listeners.
let activeUncaught = null;
let activeRejection = null;

/**
 * Install the global error net. Registers `uncaughtException` and
 * `unhandledRejection` handlers, runs the boot-time writability check (throws here
 * on a bad path), and returns `{ capture, captureSync }`. Idempotent: calling it
 * again swaps in the new options and rebinds the handlers without duplicating them.
 *
 * @param {InstallOptions} [opts]
 * @returns {{ capture: (err: unknown, extra?: Object) => void, captureSync: (err: unknown, extra?: Object) => void }}
 */
export function install(opts = {}) {
  const { file, context = {}, exitOnUncaught = true, exitOnRejection = false, maxBytes } = opts;

  // Create the sink first: its boot check throws *here* on a bad path, before any
  // handler is registered — fail loud at install, not in the dark later.
  const s = sink({ file, maxBytes });

  /** Manual capture at a boundary. Fire-and-forget (never throws, never exits). */
  const capture = (err, extra = {}) => {
    s.write(normalize(err, 'manual', { ...context, ...extra }));
  };

  /**
   * Manual capture that writes *synchronously* before returning — for short-lived
   * processes (CLIs, cron, pipe transports) that capture-then-exit, where the
   * async `capture()` line is lost because `process.exit()` kills the event loop
   * before the append flushes. Same record and merge as `capture`; never throws.
   * The exit-code decision stays yours: `captureSync(err); process.exit(1)`.
   */
  const captureSync = (err, extra = {}) => {
    s.writeSync(normalize(err, 'manual', { ...context, ...extra }));
  };

  // Drop any handlers a previous install() registered, so we never stack a pair.
  if (activeUncaught) process.removeListener('uncaughtException', activeUncaught);
  if (activeRejection) process.removeListener('unhandledRejection', activeRejection);

  activeUncaught = (err) => {
    // Sync write so the final line is on disk before we exit.
    s.writeSync(normalize(err, 'uncaught', context));
    if (exitOnUncaught) process.exit(1);
  };
  activeRejection = (reason) => {
    if (exitOnRejection) {
      // Opt-in fatal path: write *synchronously* (the line is guaranteed before we
      // die), then exit(1). For short-lived processes where a silent exit-0 would
      // be misread as success (e.g. a mail pipe reporting "delivered").
      s.writeSync(normalize(reason, 'unhandledRejection', context));
      process.exit(1);
    } else {
      // Default: log only — intentionally does NOT exit. Registering this handler
      // suppresses Node's default crash-on-rejection: a stray rejection shouldn't
      // down a long-lived server. Flip exitOnRejection to make rejections fatal.
      s.write(normalize(reason, 'unhandledRejection', context));
    }
  };

  process.on('uncaughtException', activeUncaught);
  process.on('unhandledRejection', activeRejection);

  return { capture, captureSync };
}
