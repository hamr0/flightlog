// M3 — install(): the one public entry. Wires normalize (M1) + sink (M2) onto the
// global error net and returns capture(). This is glue: the behavior it composes
// is tested in M1/M2; here we test the wiring and the crash policy (PRD §7).
import { normalize } from './normalize.js';
import { sink } from './sink.js';

/** @typedef {import('./types.js').InstallOptions} InstallOptions */

/**
 * Install the global error net. Registers `uncaughtException` and
 * `unhandledRejection` handlers, runs the boot-time writability check (throws here
 * on a bad path), and returns `capture`.
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

  process.on('uncaughtException', (err) => {
    // Sync write so the final line is on disk before we exit.
    s.writeSync(normalize(err, 'uncaught', context));
    if (exitOnUncaught) process.exit(1);
  });

  process.on('unhandledRejection', (reason) => {
    // Log only — intentionally does NOT exit. Registering this handler suppresses
    // Node's default crash-on-rejection: a stray rejection shouldn't down a server.
    s.write(normalize(reason, 'unhandledRejection', context));
  });

  return { capture };
}
