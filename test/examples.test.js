// Tests for the repo-only reference scripts in examples/. They are NOT shipped
// (excluded from package.json `files`), but adopters copy them — so the security
// guards surfaced by the /security audit are regression-locked here: ship.js must
// fail closed on a non-HTTPS endpoint (L1), and read.js's printed jq hint must be
// safe to paste (L3). Integration-first per the Testing Trophy.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, chmodSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createShipper } from '../examples/ship.js';
import { read, summarize } from '../examples/read.js';

const READ_JS = join(dirname(fileURLToPath(import.meta.url)), '..', 'examples', 'read.js');

function tmp(t) {
  const dir = mkdtempSync(join(tmpdir(), 'flightlog-ex-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** Seed a JSONL with 3 valid records (two procs, two kinds) + one torn line. */
function seed(dir) {
  const file = join(dir, 'errors.jsonl');
  writeFileSync(file, [
    '{"ts":"2026-05-30T10:00:00.000Z","kind":"uncaught","name":"TypeError","message":"x","proc":"server"}',
    '{"ts":"2026-06-01T09:00:00.000Z","kind":"manual","name":"Error","message":"checkout","where":"request","proc":"server"}',
    'torn line {not json',
    '{"ts":"2026-06-01T09:05:00.000Z","kind":"manual","name":"Error","message":"cron","where":"job","proc":"cron"}',
    '',
  ].join('\n'));
  return file;
}

// ---- ship.js — HTTPS fail-closed (audit L1) ------------------------------

test('ship.js: a non-HTTPS endpoint fails closed and never fetches', async (t) => {
  const file = seed(tmp(t));
  let fetched = false;
  const real = globalThis.fetch;
  globalThis.fetch = async () => { fetched = true; return { ok: true }; };
  t.after(() => { globalThis.fetch = real; });

  const ship = createShipper({ file, endpoint: 'http://insecure.example/ingest', consent: () => true });
  assert.deepEqual(await ship.shipOnce(), { sent: 0, error: 'endpoint must be https' });
  assert.equal(fetched, false, 'a cleartext endpoint must not transmit logs');
});

test('ship.js: the HTTPS guard runs before consent (it is a config error, not a read)', async (t) => {
  const file = seed(tmp(t));
  const ship = createShipper({
    file,
    endpoint: 'http://x',
    consent: () => { throw new Error('consent must not be consulted on a bad endpoint'); },
  });
  assert.equal((await ship.shipOnce()).error, 'endpoint must be https');
});

test('ship.js: an HTTPS endpoint passes the guard; consent still gates', async (t) => {
  const file = seed(tmp(t));
  const ship = createShipper({ file, endpoint: 'https://ok.example/ingest', consent: () => false });
  assert.deepEqual(await ship.shipOnce(), { sent: 0, skipped: 'no-consent' });
});

test('ship.js: HTTPS + consent ships whole lines (torn line skipped), then nothing new', async (t) => {
  const file = seed(tmp(t));
  let calledUrl = null; let body = null;
  const real = globalThis.fetch;
  globalThis.fetch = async (url, opts) => { calledUrl = url; body = JSON.parse(opts.body); return { ok: true }; };
  t.after(() => { globalThis.fetch = real; });

  const ship = createShipper({ file, endpoint: 'https://ok.example/ingest', consent: () => true });
  const res = await ship.shipOnce();
  assert.equal(calledUrl, 'https://ok.example/ingest');
  assert.equal(res.sent, 3, 'three valid records ship; the torn line is skipped');
  assert.equal(body.records.length, 3);
  assert.deepEqual(await ship.shipOnce(), { sent: 0 }, 'offset advanced — nothing new on the second run');
});

test('ship.js: a failed POST keeps the offset so the batch retries', async (t) => {
  const file = seed(tmp(t));
  const real = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 503 });
  t.after(() => { globalThis.fetch = real; });

  const ship = createShipper({ file, endpoint: 'https://ok.example/ingest', consent: () => true });
  assert.equal((await ship.shipOnce()).error, 'HTTP 503');
  globalThis.fetch = async () => ({ ok: true }); // recover
  assert.equal((await ship.shipOnce()).sent, 3, 'the un-acked batch ships again — offset was not advanced');
});

// ---- read.js — filters + torn-line skip ----------------------------------

test('read.js: filters by kind / match / since / tail and skips torn lines', async (t) => {
  const file = seed(tmp(t));
  assert.equal((await read(file, { kind: 'uncaught' })).length, 1);
  assert.equal((await read(file, { match: { proc: 'cron' } })).length, 1);
  assert.equal((await read(file, { since: '2026-06-01' })).length, 2);
  assert.equal((await read(file)).length, 3, 'three valid records; the torn line is skipped, never throws');
  const last = await read(file, { tail: 1 });
  assert.equal(last.length, 1);
  assert.equal(last[0].where, 'job', 'tail keeps the most recent match');
});

test('read.js: summarize() lifts core fields out and keeps context as a tail', () => {
  const line = summarize({ ts: 't', kind: 'manual', name: 'E', message: 'm', stack: 's', where: 'x', userId: 7 });
  assert.match(line, /t\s+manual\s+E: m/);
  assert.match(line, /"where":"x"/);
  assert.match(line, /"userId":7/);
  assert.doesNotMatch(line, /stack|"name"|"ts"/, 'core fields are not duplicated into the context tail');
});

// ---- read.js — the printed jq hint is paste-safe (audit L3) ---------------

test('read.js: the printed jq hint is shell-safe to paste (no command injection)',
  { skip: process.platform === 'win32' ? 'POSIX shell only' : false }, (t) => {
    const dir = tmp(t);
    const file = seed(dir);
    const marker = join(dir, 'PWNED');

    // A fake `jq` on PATH that ignores its args, so we exercise the *quoting*
    // without needing jq installed. If the hostile value broke out of the quotes,
    // the injected `touch <marker>` would run as its own shell command.
    const binDir = join(dir, 'bin');
    mkdirSync(binDir);
    const fakeJq = join(binDir, 'jq');
    writeFileSync(fakeJq, '#!/bin/sh\nexit 0\n');
    chmodSync(fakeJq, 0o755);

    const hostile = `x"; touch ${marker} #`;
    const printed = spawnSync(process.execPath, [READ_JS, file, '--kind', hostile], { encoding: 'utf8' });
    const hint = printed.stderr.split('\n').find((l) => l.includes('jq -c'));
    assert.ok(hint, 'a jq-equivalent hint was printed');

    // Run exactly what a user would paste, with the fake jq first on PATH.
    const run = spawnSync('/bin/sh', ['-c', hint], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${binDir}:${process.env.PATH}` },
    });
    assert.equal(run.status, 0, 'the pasted hint runs cleanly');
    assert.equal(existsSync(marker), false, 'no injection — the hostile value stayed a jq string literal');
  });
