// M2 — the sink: all of flightlog's file I/O behind { write, writeSync }. No
// global handlers here. A write must NEVER crash the app (PRD §8) and a broken
// sink must NEVER be silent (one stderr line, then quiet until it recovers).
import { appendFile } from 'node:fs/promises';
import { appendFileSync, mkdirSync, statSync, renameSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';

/** Default size cap before rotation (~5 MB). `0` disables rotation entirely. */
const DEFAULT_MAX_BYTES = 5_000_000;

/**
 * Mode the log file is created with. Owner read/write only: the log holds error
 * messages/stacks/context that may incidentally carry sensitive strings, so it
 * must not be group/world-readable by default on a shared host. `mode` only
 * applies when the file is created, so this never alters an existing file's perms
 * (an adopter who wants it more permissive can chmod).
 */
const FILE_MODE = 0o600;

/**
 * @typedef {Object} SinkOptions
 * @property {string} [file]  JSONL path. Omit → write to stderr (no rotation).
 * @property {number} [maxBytes=5000000]  Rotate when a write would cross this;
 *   `0` disables rotation.
 */

/**
 * Build a sink. Performs the boot-time writability check eagerly: a misconfigured
 * path throws *here*, at install, not in the dark at the first real error.
 * @param {SinkOptions} [opts]
 * @returns {{ write: (record: Object) => Promise<void>, writeSync: (record: Object) => void }}
 */
export function sink({ file, maxBytes = DEFAULT_MAX_BYTES } = {}) {
  if (!file) return stderrSink();

  // Boot-time writability check — fail loud now. mkdir the parent, then probe an
  // append (creates the file if missing; throws EACCES/EROFS/ENOTDIR/… on a bad path).
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, '', { mode: FILE_MODE });

  let warned = false;

  /** Surface a write failure once, on stderr, naming the errno. Self-failsafe. */
  const warnOnce = (err) => {
    if (warned) return;
    warned = true;
    try {
      const code = err && err.code ? ` (${err.code})` : '';
      process.stderr.write(`flightlog: write to ${file} failed${code}: ${err && err.message}\n`);
    } catch { /* even stderr is gone — last resort: stay silent rather than crash */ }
  };

  /** If appending `byteLength` would cross the cap, roll current → `.1`. */
  const rotateIfNeeded = (byteLength) => {
    if (!maxBytes) return; // 0 → disabled
    let size = 0;
    try { size = statSync(file).size; } catch { return; } // no file yet → nothing to roll
    if (size > 0 && size + byteLength > maxBytes) {
      const prev = file + '.1';
      rmSync(prev, { force: true }); // keep only one previous segment; cross-platform overwrite
      renameSync(file, prev);
    }
  };

  return {
    async write(record) {
      try {
        const line = JSON.stringify(record) + '\n';
        rotateIfNeeded(Buffer.byteLength(line));
        await appendFile(file, line, { mode: FILE_MODE });
        warned = false; // reset-on-success
      } catch (err) {
        warnOnce(err);
      }
    },
    writeSync(record) {
      try {
        const line = JSON.stringify(record) + '\n';
        rotateIfNeeded(Buffer.byteLength(line));
        appendFileSync(file, line, { mode: FILE_MODE });
        warned = false; // reset-on-success
      } catch (err) {
        warnOnce(err);
      }
    },
  };
}

/** Sink with no file: emit each record as one JSONL line to stderr, never throw. */
function stderrSink() {
  const emit = (record) => {
    try {
      process.stderr.write(JSON.stringify(record) + '\n');
    } catch { /* swallow — a logger must never crash its host */ }
  };
  return { write: async (record) => emit(record), writeSync: emit };
}
