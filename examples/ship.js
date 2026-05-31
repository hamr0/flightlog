// examples/ship.js — REFERENCE, not part of flightlog.
//
// A consent-gated uploader for a flightlog JSONL. This is the layer flightlog
// deliberately does NOT provide: flightlog records errors locally and never
// phones home. If you want logs sent back to you (e.g. a customer "send
// diagnostics" opt-in), you build that on top of the JSONL — and this file is a
// complete, working starting point. Copy it into your app and adapt the
// endpoint / auth / consent to your setup.
//
// Repo-only: not in package.json `files`, so it is never shipped in the npm
// tarball and is never a dependency. Zero deps (global `fetch` + `node:fs`).
// Never throws — a shipper must never become the bug, the same rule as the
// recorder. When it earns its place (you ship it across more than one app),
// graduate it into its own zero-dep package; never fold transport into flightlog.

import { open, stat, readFile, writeFile } from 'node:fs/promises';

/**
 * @param {object} opts
 * @param {string} opts.file       The same `file` you passed flightlog's install().
 * @param {string} opts.endpoint   An HTTPS URL you control; receives a JSON batch.
 * @param {() => boolean | Promise<boolean>} opts.consent  Your app's opt-in check.
 *   Returns false → nothing is read and nothing leaves the disk.
 * @param {string} [opts.statePath]  Where to remember how far we've sent (a byte
 *   offset). Defaults to `${file}.shipped`.
 * @param {Record<string, unknown>} [opts.meta]  Static envelope fields (app,
 *   version, installId…) sent with every batch.
 * @param {Record<string, string>} [opts.headers]  Extra request headers, e.g.
 *   `{ authorization: 'Bearer ' + installToken }`.
 * @param {number} [opts.maxBatchBytes]  Cap a single upload (default 1 MB).
 */
export function createShipper({
  file,
  endpoint,
  consent,
  statePath = `${file}.shipped`,
  meta = {},
  headers = {},
  maxBatchBytes = 1_000_000,
}) {
  let busy = false;
  let timer = null;

  const readOffset = async () => {
    try { return Number(await readFile(statePath, 'utf8')) || 0; } catch { return 0; }
  };
  const writeOffset = async (n) => {
    try { await writeFile(statePath, String(n)); } catch { /* best-effort; resend next run */ }
  };

  /** Send everything not yet sent. Returns a small result object; never throws. */
  async function shipOnce() {
    if (busy) return { sent: 0, skipped: 'busy' };
    busy = true;
    try {
      if (!(await consent())) return { sent: 0, skipped: 'no-consent' };

      let size;
      try { size = (await stat(file)).size; } catch { return { sent: 0, skipped: 'no-file' }; }

      let offset = await readOffset();
      // Rotation/truncation: flightlog rolls the file to `${file}.1` at maxBytes,
      // so a file now smaller than our offset means it rotated. We restart from 0
      // here — simple, but it can skip lines that rolled out between two sends. In
      // practice, ship far more often than you rotate (e.g. every few minutes vs a
      // 5 MB cap) and that window is tiny; for true losslessness, drain `${file}.1`
      // from the old offset before resetting.
      if (offset > size) offset = 0;
      if (offset >= size) return { sent: 0 }; // nothing new

      const end = Math.min(size, offset + maxBatchBytes);
      const fh = await open(file, 'r');
      let chunk;
      try {
        const buf = Buffer.alloc(end - offset);
        await fh.read(buf, 0, buf.length, offset);
        chunk = buf.toString('utf8');
      } finally {
        await fh.close();
      }

      // Ship only whole lines; a partial trailing line waits for the next run.
      const lastNl = chunk.lastIndexOf('\n');
      if (lastNl === -1) return { sent: 0 };
      const complete = chunk.slice(0, lastNl + 1);
      const advanceBy = Buffer.byteLength(complete);

      const records = [];
      for (const l of complete.split('\n').filter(Boolean)) {
        try { records.push(JSON.parse(l)); } catch { /* skip a torn line, never throw */ }
      }
      if (records.length === 0) { await writeOffset(offset + advanceBy); return { sent: 0 }; }

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify({ ...meta, sentAt: new Date().toISOString(), records }),
      });
      if (!res.ok) return { sent: 0, error: `HTTP ${res.status}` }; // keep offset → retry next run

      await writeOffset(offset + advanceBy); // advance ONLY on a confirmed send
      return { sent: records.length };
    } catch (err) {
      return { sent: 0, error: String(err?.message || err) }; // never throw
    } finally {
      busy = false;
    }
  }

  /** Trickle in the background. Returns the stop() handle. */
  function start(intervalMs = 60_000) {
    if (timer) return stop;
    timer = setInterval(() => { shipOnce(); }, intervalMs);
    timer.unref?.(); // don't keep a process alive just to ship
    return stop;
  }
  function stop() { if (timer) { clearInterval(timer); timer = null; } }

  return { shipOnce, start, stop };
}

// --- Wiring (delete or guard in your app) ---------------------------------
//
// import { install } from 'flightlog';
// import { createShipper } from './ship.js';
// import { diagnosticsEnabled } from './settings.js'; // your opt-in toggle, default OFF
//
// const FILE = '/var/lib/myapp/errors.jsonl';
// const { capture, captureSync } = install({ file: FILE, context: { app: 'myapp', version: '1.2.0' } });
//
// const ship = createShipper({
//   file: FILE,
//   endpoint: 'https://logs.myapp.example/ingest',
//   consent: diagnosticsEnabled,                          // the only gate that matters
//   meta: { app: 'myapp', version: '1.2.0', installId },
//   headers: { authorization: `Bearer ${installToken}` }, // per-install token
// });
//
// ship.start(5 * 60_000);  // background trickle, only when consent is on
// // …or Windows-error-report style: on a crash prompt, user clicks "Send" → await ship.shipOnce();
