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

test('fatal breadcrumb: uncaught with a file sink prints one stderr pointer before exit', (t) => {
  // PRD Ask 1: the crash cause must reach the process journal (stderr → journald),
  // not only the JSONL sink. One line, name:message + the file path, then exit 1.
  const { status, stderr, recs } = run(t, 'uncaught');
  assert.equal(status, 1);
  assert.equal(recs.length, 1, 'full record still lands in the JSONL sink');
  const lines = stderr.split('\n').filter((l) => l.startsWith('flightlog: fatal'));
  assert.equal(lines.length, 1, 'exactly one breadcrumb, not a second copy of the stack');
  assert.match(lines[0], /^flightlog: fatal uncaught — Error: uncaught boom \(recorded to .*errors\.jsonl\)$/);
});

test('fatal breadcrumb: exitOnRejection:true prints one stderr pointer before exit', (t) => {
  const { status, stderr } = run(t, 'rejection-fatal');
  assert.equal(status, 1);
  const lines = stderr.split('\n').filter((l) => l.startsWith('flightlog: fatal'));
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^flightlog: fatal unhandledRejection — Error: rejected fatal \(recorded to .*errors\.jsonl\)$/);
});

test('fatal breadcrumb: log-only rejection (exitOnRejection:false) emits NO breadcrumb', (t) => {
  // A stray rejection on a healthy long-lived server must not start printing to stderr.
  const { status, stderr, recs } = run(t, 'rejection');
  assert.equal(status, 0);
  assert.equal(recs.length, 1, 'record still logged to the file');
  assert.ok(!stderr.includes('flightlog: fatal'), 'no breadcrumb on the non-fatal path');
});

test('fatal breadcrumb: no file sink → no breadcrumb (record already on stderr)', (t) => {
  // With a stderr sink the record itself is already on stderr; a breadcrumb would
  // just double-print. The JSONL record IS present on stderr; the pointer is not.
  const { status, stderr } = run(t, 'uncaught-nofile');
  assert.equal(status, 1);
  assert.ok(!stderr.includes('flightlog: fatal'), 'no double-print when the sink is stderr');
  assert.match(stderr, /"kind":"uncaught".*"message":"nofile boom"/, 'the full record went to stderr');
});

test('fatal breadcrumb: control chars in the message are neutralized to one safe line', (t) => {
  // Security: an attacker-influenced message must not smuggle ESC/CR/LF into the
  // journal (terminal spoof / forged log line). Controls render as \xNN; one line.
  const { status, stderr } = run(t, 'uncaught-controlchars');
  assert.equal(status, 1);
  const lines = stderr.split('\n').filter((l) => l.startsWith('flightlog: fatal'));
  assert.equal(lines.length, 1, 'the breadcrumb stays a single physical line');
  assert.ok(!/[\u0000-\u001f\u007f-\u009f]/.test(lines[0]), 'no raw control bytes reach the terminal');
  assert.match(lines[0], /boom\\x0d\\x1b\[2K\\x0ainjected/, 'CR/ESC/LF rendered visibly as \\xNN');
});

test('fatal breadcrumb: degraded sink → "record DROPPED" wording, not a false "recorded to"', (t) => {
  // Edge case: file set but bootCheck:false + unwritable path → the write was dropped,
  // so this stderr line is the only copy. The pointer must not claim it landed.
  const dir = tmp(t);
  const blocker = join(dir, 'blocker');
  writeFileSync(blocker, 'x');
  const badFile = join(blocker, 'sub', 'errors.jsonl'); // parent is a file → unwritable
  const res = spawnSync(process.execPath, [FIXTURE, badFile, 'uncaught-degraded'], { encoding: 'utf8' });
  assert.equal(res.status, 1);
  const lines = res.stderr.split('\n').filter((l) => l.startsWith('flightlog: fatal'));
  assert.equal(lines.length, 1);
  assert.match(lines[0], /record DROPPED, .*errors\.jsonl unwritable\)$/);
  assert.ok(!lines[0].includes('recorded to'), 'no optimistic "recorded to" when the write was dropped');
});

test('fatal breadcrumb: a broken stderr does not throw or change the exit code', (t) => {
  // The process is already dying; a breadcrumb write that itself throws must be
  // swallowed. Record still lands on the (healthy) file sink; exit stays 1.
  const { status, recs } = run(t, 'uncaught-broken-stderr');
  assert.equal(status, 1, 'exit code unchanged despite stderr throwing in the breadcrumb');
  assert.equal(recs.length, 1, 'the JSONL record still landed');
  assert.equal(recs[0].message, 'broken stderr boom');
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
