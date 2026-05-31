// E2E — consume the ACTUAL packed tarball as a real npm dependency. Builds types,
// `npm pack`s, extracts into node_modules/flightlog, then imports via the bare
// 'flightlog' specifier (exercising the exports map + files allowlist) and runs a
// real capture end to end. This is the only test that proves the published artifact
// — not just the source tree — actually works.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync, mkdirSync, renameSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

test('packed tarball is consumable via the public "flightlog" import', (t) => {
  const work = mkdtempSync(join(tmpdir(), 'flightlog-e2e-'));
  t.after(() => rmSync(work, { recursive: true, force: true }));

  // Mirror publish: build the .d.ts, then pack the real tarball.
  const build = spawnSync('npm', ['run', 'build:types'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(build.status, 0, `build:types failed: ${build.stderr}`);
  const pack = spawnSync('npm', ['pack', '--pack-destination', work], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(pack.status, 0, `npm pack failed: ${pack.stderr}`);
  const tgz = readdirSync(work).find((f) => f.endsWith('.tgz'));
  assert.ok(tgz, 'a tarball was produced');

  // Extract into node_modules/flightlog (offline — no registry needed).
  const nm = join(work, 'node_modules');
  mkdirSync(nm, { recursive: true });
  const untar = spawnSync('tar', ['-xzf', join(work, tgz), '-C', nm], { encoding: 'utf8' });
  assert.equal(untar.status, 0, `tar failed: ${untar.stderr}`);
  renameSync(join(nm, 'package'), join(nm, 'flightlog')); // npm tarballs unpack to package/

  // The shipped contract: the generated .d.ts must be in the consumed package.
  assert.ok(existsSync(join(nm, 'flightlog', 'types', 'index.d.ts')), 'types ship in the tarball');
  assert.ok(existsSync(join(nm, 'flightlog', 'flightlog.context.md')), 'context.md ships');
  assert.ok(!existsSync(join(nm, 'flightlog', 'docs')), 'docs/ does NOT ship');

  // A real consumer importing by bare specifier (resolves via the exports map).
  const jsonl = join(work, 'errors.jsonl');
  const consumer = join(work, 'use.mjs');
  writeFileSync(consumer, `
    import { install } from 'flightlog';
    import { readFileSync, existsSync } from 'node:fs';
    const { capture } = install({ file: ${JSON.stringify(jsonl)}, context: { app: 'consumer' } });
    capture(new Error('e2e boom'), { where: 'tarball' });
    const start = Date.now();
    while (!(existsSync(${JSON.stringify(jsonl)}) && readFileSync(${JSON.stringify(jsonl)}, 'utf8').includes('e2e boom'))) {
      if (Date.now() - start > 4000) { process.exit(3); }
      await new Promise((r) => setTimeout(r, 10));
    }
    process.exit(0);
  `);
  const run = spawnSync(process.execPath, [consumer], { cwd: work, encoding: 'utf8' });
  assert.equal(run.status, 0, `consumer failed (status ${run.status}): ${run.stderr}`);

  const rec = JSON.parse(readFileSync(jsonl, 'utf8').split('\n').filter(Boolean)[0]);
  assert.equal(rec.kind, 'manual');
  assert.equal(rec.message, 'e2e boom');
  assert.equal(rec.app, 'consumer'); // install context
  assert.equal(rec.where, 'tarball'); // per-call extra
});
