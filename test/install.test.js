// M3 — integration tests for install(opts) → { capture }. Each scenario runs in a
// child process (global handlers + process.exit can't be tested cleanly in-process)
// and we assert on exit code + the JSONL file. Covers PRD §3.2 (all kinds), §7
// (crash policy), and the confirmed rejection-log-only behavior.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), '..', 'test-fixtures', 'run.mjs');

function tmp(t) {
  const dir = mkdtempSync(join(tmpdir(), 'flightlog-m3-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** Run the fixture for a scenario; return { status, stderr, recs }. */
function run(t, scenario, exitFlag) {
  const file = join(tmp(t), 'errors.jsonl');
  const args = [FIXTURE, file, scenario];
  if (exitFlag !== undefined) args.push(exitFlag);
  const res = spawnSync(process.execPath, args, { encoding: 'utf8' });
  const recs = existsSync(file)
    ? readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
    : [];
  return { status: res.status, stderr: res.stderr, recs };
}

test('manual capture: one line, kind=manual, context + extra merged', (t) => {
  const { status, recs } = run(t, 'manual');
  assert.equal(status, 0, 'capture() does not exit the process');
  assert.equal(recs.length, 1);
  const r = recs[0];
  assert.equal(r.kind, 'manual');
  assert.equal(r.name, 'Error');
  assert.equal(r.message, 'manual boom');
  assert.equal(r.app, 'fix');       // static context
  assert.equal(r.release, 'v1');    // static context
  assert.equal(r.where, 'unit');    // per-call extra
});

test('manual capture with no context: default-out (only core fields)', (t) => {
  const { status, recs } = run(t, 'manual-bare');
  assert.equal(status, 0);
  assert.deepEqual(Object.keys(recs[0]), ['ts', 'kind', 'name', 'message', 'stack']);
});

test('captureSync: writes synchronously and survives an immediate process.exit', (t) => {
  // The adopter's Problem 1 — capture-then-exit. No await, no event-loop turn:
  // the line must already be on disk when the process dies.
  const { status, recs } = run(t, 'manual-sync');
  assert.equal(status, 7, 'exit code stays the caller\'s — captureSync does not exit');
  assert.equal(recs.length, 1, 'the sync line landed despite the immediate exit');
  const r = recs[0];
  assert.equal(r.kind, 'manual');
  assert.equal(r.message, 'sync boom');
  assert.equal(r.app, 'fix');     // static context still merged
  assert.equal(r.where, 'exit');  // per-call extra still merged
});

test('captureSync: returns { ok:true } through install() on a healthy sink', (t) => {
  const file = join(tmp(t), 'errors.jsonl');
  const res = spawnSync(process.execPath, [FIXTURE, file, 'manual-sync-status'], { encoding: 'utf8' });
  assert.equal(res.status, 0);
  assert.deepEqual(JSON.parse(res.stdout.trim()), { ok: true }, 'the write-landed signal reaches the caller');
});

test('captureSync: returns { ok:false, errno } when the sink is degraded (bootCheck:false)', (t) => {
  // The plato gap (PRD §15.4): a per-invocation process whose error sink is broken
  // can now SEE the dropped write and choose to exit non-zero instead of blind.
  const dir = tmp(t);
  const blocker = join(dir, 'blocker');
  writeFileSync(blocker, 'x');
  const badFile = join(blocker, 'sub', 'errors.jsonl'); // parent is a file → unwritable
  const res = spawnSync(process.execPath, [FIXTURE, badFile, 'manual-sync-status-broken'], { encoding: 'utf8' });
  assert.equal(res.status, 0, 'still never throws — the signal is a return value, not a crash');
  const out = JSON.parse(res.stdout.trim());
  assert.equal(out.ok, false, 'the dropped write is reported, not silently swallowed');
  assert.match(out.errno, /ENOTDIR|EEXIST|ENOENT|EACCES/, 'an errno accompanies the failure');
});

test('uncaught (default): logs synchronously then exits 1', (t) => {
  const { status, recs } = run(t, 'uncaught');
  assert.equal(status, 1, 'exitOnUncaught default → exit(1) for the supervisor');
  assert.equal(recs.length, 1);
  assert.equal(recs[0].kind, 'uncaught');
  assert.equal(recs[0].message, 'uncaught boom');
});

test('uncaught with exitOnUncaught:false: logs and stays alive (exit 0)', (t) => {
  const { status, recs } = run(t, 'uncaught', 'false');
  assert.equal(status, 0, 'log-and-stay-alive for CLIs/desktop');
  assert.equal(recs.length, 1);
  assert.equal(recs[0].kind, 'uncaught');
});

test('uncaught non-Error throw: normalized line, stack synthesized', (t) => {
  const { status, recs } = run(t, 'uncaught-nonerror');
  assert.equal(status, 1);
  assert.equal(recs[0].kind, 'uncaught');
  assert.equal(recs[0].name, 'Error');
  assert.equal(recs[0].message, 'string boom');
  assert.ok(recs[0].stack, 'synthesized stack present for a non-Error throw');
});

test('unhandledRejection: logs only and does NOT crash (exit 0)', (t) => {
  const { status, recs } = run(t, 'rejection');
  assert.equal(status, 0, 'rejections are log-only — Node default crash is suppressed');
  assert.equal(recs.length, 1);
  assert.equal(recs[0].kind, 'unhandledRejection');
  assert.equal(recs[0].message, 'rejected boom');
});

test('unhandledRejection with exitOnRejection:true: writes synchronously then exits 1', (t) => {
  // The adopter's Problem 2 — a rejection-class failure in a short-lived process
  // must be able to die non-zero, with the line guaranteed (sync) on the way out.
  const { status, recs } = run(t, 'rejection-fatal');
  assert.equal(status, 1, 'exitOnRejection makes a stray rejection fatal (exit 1)');
  assert.equal(recs.length, 1);
  assert.equal(recs[0].kind, 'unhandledRejection');
  assert.equal(recs[0].message, 'rejected fatal');
});

test('idempotent: a second install() does not stack handlers or double-log', (t) => {
  const file = join(tmp(t), 'errors.jsonl');
  const res = spawnSync(process.execPath, [FIXTURE, file, 'double-install'], { encoding: 'utf8' });
  assert.equal(res.status, 0);
  const counts = JSON.parse(res.stdout.trim().split('\n')[0]);
  assert.equal(counts.uncaught, 1, 'exactly one uncaughtException handler after two installs');
  assert.equal(counts.rejection, 1, 'exactly one unhandledRejection handler after two installs');
  const recs = readFileSync(file, 'utf8').split('\n').filter(Boolean);
  assert.equal(recs.length, 1, 'one rejection logged once, not twice');
});

test('bad path: install() throws loud at the boot check (non-zero exit)', (t) => {
  // a regular file used as a parent directory → parent dir can't be created (ENOTDIR).
  const dir = tmp(t);
  const blocker = join(dir, 'blocker');
  writeFileSync(blocker, 'x');
  const badFile = join(blocker, 'sub', 'errors.jsonl');
  const res = spawnSync(process.execPath, [FIXTURE, badFile, 'install-badpath'], { encoding: 'utf8' });
  assert.notEqual(res.status, 0, 'a misconfigured path fails at install, not silently');
  assert.match(res.stderr, /ENOTDIR|EEXIST|ENOENT/);
});

test('bad path with bootCheck:false: install() does NOT throw — warns once and continues', (t) => {
  // gitdone's per-message shape: a fatal boot would defer all mail. bootCheck:false
  // keeps the process alive so the real work proceeds; the broken sink just warns.
  const dir = tmp(t);
  const blocker = join(dir, 'blocker');
  writeFileSync(blocker, 'x');
  const badFile = join(blocker, 'sub', 'errors.jsonl');
  const res = spawnSync(process.execPath, [FIXTURE, badFile, 'install-badpath-nonfatal'], { encoding: 'utf8' });
  assert.equal(res.status, 0, 'a short-lived process survives an unwritable sink at boot');
  assert.match(res.stdout, /survived/, 'execution continued past install()');
  assert.match(res.stderr, /flightlog: write to .* failed.*(ENOTDIR|EEXIST|ENOENT|EACCES)/, 'the broken sink is surfaced once on stderr');
});
