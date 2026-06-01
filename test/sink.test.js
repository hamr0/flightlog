// M2 — integration tests for sink({ file, maxBytes }) → { write, writeSync }.
// Real tmp files, no FS mocking (Testing Trophy). Covers PRD §3.1/3.3/3.4/3.5:
// append, rotation at maxBytes, swallow-never-crash + warn-once (reset-on-success),
// and the boot-time writability check that fails loud on a bad path.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync, rmSync, mkdirSync, rmdirSync, writeFileSync, readFileSync, statSync, existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sink } from '../src/sink.js';

/** Make a fresh tmp dir; register cleanup on the test context. */
function tmp(t) {
  const dir = mkdtempSync(join(tmpdir(), 'flightlog-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** Capture process.stderr.write for the duration of fn. */
async function captureStderr(fn) {
  const orig = process.stderr.write;
  const lines = [];
  process.stderr.write = (chunk) => { lines.push(String(chunk)); return true; };
  try { await fn(); } finally { process.stderr.write = orig; }
  return lines;
}

function readLines(file) {
  return readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

test('write: appends one JSONL line per call', async (t) => {
  const file = join(tmp(t), 'errors.jsonl');
  const s = sink({ file });
  await s.write({ ts: 't1', kind: 'manual', msg: 'a' });
  await s.write({ ts: 't2', kind: 'manual', msg: 'b' });
  const recs = readLines(file);
  assert.equal(recs.length, 2);
  assert.deepEqual(recs[0], { ts: 't1', kind: 'manual', msg: 'a' });
  assert.deepEqual(recs[1], { ts: 't2', kind: 'manual', msg: 'b' });
});

test('writeSync: appends one JSONL line per call (death path)', async (t) => {
  const file = join(tmp(t), 'errors.jsonl');
  const s = sink({ file });
  s.writeSync({ kind: 'uncaught', msg: 'dying' });
  const recs = readLines(file);
  assert.equal(recs.length, 1);
  assert.equal(recs[0].msg, 'dying');
});

test('writeSync: returns { ok:true } when the line lands', (t) => {
  const file = join(tmp(t), 'errors.jsonl');
  const s = sink({ file });
  const res = s.writeSync({ kind: 'manual', msg: 'ok' });
  assert.deepEqual(res, { ok: true }, 'success reports ok:true, no errno');
});

test('writeSync: returns { ok:false, errno } when the sink is broken (no throw)', async (t) => {
  const file = join(tmp(t), 'errors.jsonl');
  const s = sink({ file, maxBytes: 0 }); // boot ok
  rmSync(file);
  mkdirSync(file); // sabotage: path is a directory → appendFileSync EISDIR

  let res;
  const warnings = await captureStderr(() => { res = s.writeSync({ a: 1 }); });
  assert.equal(res.ok, false, 'a swallowed write reports ok:false instead of throwing');
  assert.equal(res.errno, 'EISDIR', 'the errno is surfaced to the caller');
  assert.equal(warnings.length, 1, 'still warns once to stderr (unchanged)');
});

test('boot check: a bad path throws at construction, not at first write', (t) => {
  const dir = tmp(t);
  const notADir = join(dir, 'afile');
  writeFileSync(notADir, 'x'); // a regular file…
  const badFile = join(notADir, 'sub', 'errors.jsonl'); // …used as a parent dir → ENOTDIR
  assert.throws(() => sink({ file: badFile }), /ENOTDIR|EEXIST|ENOENT/);
});

test('rotation: rolls current → .1 at maxBytes, caps disk to ~2×', async (t) => {
  const file = join(tmp(t), 'errors.jsonl');
  const s = sink({ file, maxBytes: 100 });
  // Each line is well under 100B; write enough to force at least one rotation.
  for (let i = 0; i < 8; i++) await s.write({ i, pad: 'xxxxxxxx' });

  assert.ok(existsSync(file + '.1'), 'previous segment exists');
  assert.ok(statSync(file).size <= 100, 'current segment is within the cap');
  assert.ok(statSync(file + '.1').size <= 100, 'previous segment is within the cap');

  // No data is lost across the rotation boundary: current + .1 together hold a
  // contiguous tail, and the most recent line is in the current segment.
  const current = readLines(file);
  assert.equal(current.at(-1).i, 7, 'newest line is in the live segment');
});

test('rotation: keeps only one previous segment (no .2)', async (t) => {
  const file = join(tmp(t), 'errors.jsonl');
  const s = sink({ file, maxBytes: 80 });
  for (let i = 0; i < 30; i++) await s.write({ i, pad: 'yyyyyyyy' });
  assert.ok(existsSync(file + '.1'), '.1 exists');
  assert.ok(!existsSync(file + '.2'), 'only one previous segment is kept');
});

test('maxBytes: 0 disables rotation', async (t) => {
  const file = join(tmp(t), 'errors.jsonl');
  const s = sink({ file, maxBytes: 0 });
  for (let i = 0; i < 50; i++) await s.write({ i, pad: 'zzzzzzzzzz' });
  assert.ok(!existsSync(file + '.1'), 'no rotation when disabled');
  assert.equal(readLines(file).length, 50);
});

test('default maxBytes (~5MB): small writes do not rotate', async (t) => {
  const file = join(tmp(t), 'errors.jsonl');
  const s = sink({ file }); // no maxBytes → default
  for (let i = 0; i < 20; i++) await s.write({ i });
  assert.ok(!existsSync(file + '.1'));
});

test('self-failure: a broken sink swallows (no throw) and warns exactly once', async (t) => {
  const file = join(tmp(t), 'errors.jsonl');
  const s = sink({ file, maxBytes: 0 }); // boot ok
  rmSync(file);
  mkdirSync(file); // sabotage: path is now a directory → appendFile EISDIR

  const warnings = await captureStderr(async () => {
    await s.write({ a: 1 }); // fails → swallowed + one warning
    await s.write({ a: 2 }); // still failing → no second warning (warned flag)
  });
  assert.equal(warnings.length, 1, 'warns exactly once for a sustained failure');
  assert.match(warnings[0], /EISDIR/, 'the warning names the errno');
  assert.match(warnings[0], /\n$/, 'one terminated stderr line');
});

test('self-failure: warn flag resets on success, so a later failure warns again', async (t) => {
  const file = join(tmp(t), 'errors.jsonl');
  const s = sink({ file, maxBytes: 0 });
  rmSync(file);
  mkdirSync(file); // break it

  const warnings = await captureStderr(async () => {
    await s.write({ a: 1 });   // fail → warn #1
    rmdirSync(file);           // recover: path is writable again
    await s.write({ a: 2 });   // success → resets warned
    rmSync(file); mkdirSync(file); // break again
    await s.write({ a: 3 });   // fail → warn #2 (proves reset-on-success)
  });
  assert.equal(warnings.length, 2);
});

test('security: the log file is created owner-only (0600), not world-readable',
  { skip: process.platform === 'win32' ? 'POSIX modes only' : false }, async (t) => {
    const file = join(tmp(t), 'errors.jsonl');
    const s = sink({ file });
    await s.write({ kind: 'manual', msg: 'sensitive' });
    assert.equal(statSync(file).mode & 0o777, 0o600, 'no group/world read on a shared host');

    // Survives rotation: the freshly recreated current segment is also 0600.
    const rotated = join(tmp(t), 'rot.jsonl');
    const r = sink({ file: rotated, maxBytes: 60 });
    for (let i = 0; i < 6; i++) await r.write({ i, pad: 'wwwwwwww' });
    assert.equal(statSync(rotated).mode & 0o777, 0o600);
  });

test('no file: falls back to stderr, one line per record', async (t) => {
  const s = sink({}); // no file
  const lines = await captureStderr(async () => {
    await s.write({ kind: 'manual', msg: 'to-stderr' });
  });
  assert.equal(lines.length, 1);
  assert.deepEqual(JSON.parse(lines[0]), { kind: 'manual', msg: 'to-stderr' });
});
