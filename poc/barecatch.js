// barecatch POC — global error net → one JSONL line per error. Zero deps.
// Mechanism only: catch, normalize, append. Policy (what context, where) is the adopter's.
import { appendFileSync } from 'node:fs';

/**
 * @typedef {Object} BarecatchOptions
 * @property {string} [file]   Path to JSONL sink. Omit to write to stderr.
 * @property {Object} [context] Static context merged into every record (adopter's choice).
 * @property {boolean} [exitOnUncaught=true] Re-crash after logging an uncaught error (don't swallow).
 */

/** Normalize anything-thrown into a flat, JSON-safe record. */
function normalize(err, kind, context) {
  const e = err instanceof Error ? err : new Error(String(err));
  return {
    ts: new Date().toISOString(),
    kind,                       // 'uncaught' | 'unhandledRejection' | 'manual'
    name: e.name,
    message: e.message,
    stack: e.stack,
    ...context,                 // adopter-supplied only — never auto-harvested
  };
}

/**
 * Install the global net.
 * @param {BarecatchOptions} [opts]
 * @returns {{ capture: (err: unknown, extra?: Object) => void }}
 */
export function install(opts = {}) {
  const { file, context = {}, exitOnUncaught = true } = opts;

  const write = (rec) => {
    const line = JSON.stringify(rec) + '\n';
    if (file) appendFileSync(file, line);
    else process.stderr.write(line);
  };

  const capture = (err, extra = {}) => write(normalize(err, 'manual', { ...context, ...extra }));

  process.on('uncaughtException', (err) => {
    write(normalize(err, 'uncaught', context));
    if (exitOnUncaught) process.exit(1);
  });
  process.on('unhandledRejection', (reason) => {
    write(normalize(reason, 'unhandledRejection', context));
  });

  return { capture };
}
