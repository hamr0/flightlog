// examples/read.js — REFERENCE, not part of flightlog.
//
// The read side of "the JSONL is the interface." flightlog ships no reader on
// purpose (no UI, no server, no `bin` to secure) — `jq` and `tail` already read
// the file. But the recipes are non-obvious the first time, so this file carries
// the query discipline the way `ship.js` carries the upload one: a tiny, zero-dep,
// copy-and-adapt reader that streams the JSONL and filters it.
//
// Repo-only: not in package.json `files`, so it never ships in the npm tarball and
// is never a dependency. Zero deps (`node:fs` + `node:readline` + `node:url`).
// Streams line-by-line, so it handles a multi-GB log without loading it into RAM.
// Skips malformed lines instead of throwing — a reader should never be the bug
// either.
//
// The `jq` equivalents are in the comments next to each filter, because once you
// know them you won't need this file. That's the point.

import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';

/**
 * Stream the records in a flightlog JSONL, newest-last, applying simple filters.
 * Yields parsed objects; silently skips lines that aren't valid JSON.
 *
 * @param {string} file  Path to the JSONL sink.
 * @param {object} [filter]
 * @param {string} [filter.kind]   Only this `kind` — `jq 'select(.kind=="uncaught")'`.
 * @param {Record<string, string>} [filter.match]  Field equals value, e.g.
 *   `{ where: 'request', proc: 'cron' }` — `jq 'select(.where=="request")'`.
 * @param {string} [filter.since]  ISO timestamp; only records with `ts >= since`
 *   (string compare is correct for ISO 8601) — `jq 'select(.ts>="2026-06-01")'`.
 * @returns {AsyncGenerator<Record<string, unknown>>}
 */
export async function* readRecords(file, filter = {}) {
  const rl = createInterface({
    input: createReadStream(file, 'utf8'),
    crlfDelay: Infinity,
  });
  const { kind, match = {}, since } = filter;
  for await (const line of rl) {
    if (!line.trim()) continue;
    let rec;
    try { rec = JSON.parse(line); } catch { continue; } // skip a torn/partial line
    if (kind && rec.kind !== kind) continue;
    if (since && !(typeof rec.ts === 'string' && rec.ts >= since)) continue;
    let ok = true;
    for (const [k, v] of Object.entries(match)) {
      if (String(rec[k]) !== v) { ok = false; break; }
    }
    if (ok) yield rec;
  }
}

/**
 * Collect matching records into an array. For a huge log prefer `readRecords`
 * (streaming) or `tail`/`jq`; this is the convenient form for a recent slice.
 *
 * @param {string} file
 * @param {object} [opts]  Same filters as `readRecords`, plus:
 * @param {number} [opts.tail]  Keep only the last N matches (a ring buffer, so
 *   memory stays bounded even on a giant file) — `… | tail -n N`.
 * @returns {Promise<Array<Record<string, unknown>>>}
 */
export async function read(file, opts = {}) {
  const { tail, ...filter } = opts;
  const out = [];
  for await (const rec of readRecords(file, filter)) {
    out.push(rec);
    if (tail && out.length > tail) out.shift();
  }
  return out;
}

/** One compact human line per record — like a `jq -r` summary, but control-safe. */
export function summarize(rec) {
  // Neutralize terminal control sequences before printing: a logged error message
  // can carry attacker-influenced strings, and a raw ESC / CR reaching the terminal
  // can spoof or hide output during the exact incident you're reading the log for.
  // Render C0/DEL/C1 controls visibly (`\xNN`) instead; printable UTF-8 is untouched.
  // The context tail below is already safe — JSON.stringify escapes controls.
  const safe = (v) => String(v ?? '').replace(
    /[\u0000-\u001f\u007f-\u009f]/g, (c) => '\\x' + c.charCodeAt(0).toString(16).padStart(2, '0'));
  const ctx = { ...rec };
  for (const k of ['ts', 'kind', 'name', 'message', 'stack']) delete ctx[k];
  const tail = Object.keys(ctx).length ? '  ' + JSON.stringify(ctx) : '';
  return `${safe(rec.ts)}  ${safe(rec.kind)}  ${safe(rec.name)}: ${safe(rec.message)}${tail}`;
}

// --- CLI -------------------------------------------------------------------
// Runnable directly:
//   node examples/read.js errors.jsonl --kind uncaught
//   node examples/read.js errors.jsonl --where request --tail 20
//   node examples/read.js errors.jsonl --since 2026-06-01 --raw
//   node examples/read.js errors.jsonl --match proc=cron        # multi-proc sink
// The `jq` equivalent prints under each result set so you can graduate off this.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [file, ...rest] = process.argv.slice(2);
  if (!file) {
    console.error('usage: node read.js <file.jsonl> [--kind K] [--where W] ' +
      '[--match k=v] [--since ISO] [--tail N] [--raw]');
    process.exit(2);
  }
  const opts = {};
  let raw = false;
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '--raw') raw = true;
    else if (a === '--kind') opts.kind = rest[++i];
    else if (a === '--since') opts.since = rest[++i];
    else if (a === '--tail') opts.tail = Number(rest[++i]);
    else if (a === '--where') opts.match = { ...opts.match, where: rest[++i] };
    else if (a === '--match') {
      const [k, ...v] = String(rest[++i]).split('=');
      opts.match = { ...opts.match, [k]: v.join('=') };
    }
  }
  read(file, opts)
    .then((recs) => {
      for (const r of recs) console.log(raw ? JSON.stringify(r) : summarize(r));
      console.error(`\n${recs.length} record(s).  jq equivalent:`);
      // Build the hint safely so it's paste-able verbatim: jq string literals via
      // JSON.stringify (escaped + valid jq), and both the program and the path
      // wrapped with POSIX single-quoting so an odd filter value can't break out.
      const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
      const sel = [
        opts.kind && `.kind==${JSON.stringify(opts.kind)}`,
        // Every --match / --where field (not just `where`), via portable `.["k"]`
        // access — otherwise the hint silently drops filters and returns all rows.
        ...Object.entries(opts.match ?? {}).map(([k, v]) => `.[${JSON.stringify(k)}]==${JSON.stringify(v)}`),
        opts.since && `.ts>=${JSON.stringify(opts.since)}`,
      ].filter(Boolean).join(' and ');
      console.error(`  jq -c ${shq(sel ? `select(${sel})` : '.')} ${shq(file)}` +
        (opts.tail ? ` | tail -n ${opts.tail}` : ''));
    })
    .catch((err) => { console.error(String(err?.message ?? err)); process.exit(1); });
}
