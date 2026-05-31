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
 * on a bad path), and returns `capture`. Idempotent: calling it again swaps in the
 * new options and rebinds `capture` without duplicating handlers.
 *
 * @param {InstallOptions} [opts]
 * @returns {{ capture: (err: unknown, extra?: Object) => void }}
 */
export function install(opts = {}) {
  const { file, context = {}, exitOnUncaught = true, maxBytes } = opts;

  // Create the sink first: its boot check throws *here* on a bad path, before any
  // handler is registered — fail loud at install, not in the dark later.
  const s = sink({ file, maxBytes });

  /** Manual capture at a boundary. Fire-and-forget (never throws, never exits). */
  const capture = (err, extra = {}) => {
    s.write(normalize(err, 'manual', { ...context, ...extra }));
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
    // Log only — intentionally does NOT exit. Registering this handler suppresses
    // Node's default crash-on-rejection: a stray rejection shouldn't down a server.
    s.write(normalize(reason, 'unhandledRejection', context));
  };

  process.on('uncaughtException', activeUncaught);
  process.on('unhandledRejection', activeRejection);

  return { capture };
}
