// Subprocess fixture for M3 install() integration tests. Each invocation installs
// flightlog, triggers ONE scenario, and exits — the parent asserts on exit code
// and the JSONL file. Run as: node run.mjs <file> <scenario> [exitOnUncaught]
//
// Lives outside test/ on purpose: `node --test` auto-discovers everything under a
// test/ dir, and this file is meant to be spawned with argv, not run standalone.
import { install } from '../src/index.js'; // exercise the PUBLIC entry, not the internal module
import { readFileSync, existsSync } from 'node:fs';

const [, , file, scenario, exitFlag] = process.argv;

/** Poll until `pred` is true (async-write landed on disk) — no arbitrary sleeps. */
async function waitFor(pred, timeoutMs = 3000, stepMs = 10) {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error('fixture: timed out waiting');
    await new Promise((r) => setTimeout(r, stepMs));
  }
}
const lineCount = () =>
  (existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).length : 0);

// 'install-badpath' must observe install() throwing at the boot check, before any
// handler is registered — so don't wrap it.
if (scenario === 'install-badpath') {
  install({ file }); // expected to throw → node exits non-zero with the errno
  process.exit(0); // unreachable if boot check works
}

// bootCheck:false on the same bad path must NOT throw — warn once and continue,
// so a short-lived process keeps doing its real work when only the sink is broken.
if (scenario === 'install-badpath-nonfatal') {
  const { capture } = install({ file, bootCheck: false });
  capture(new Error('after bad boot')); // also swallowed (sink unwritable), no throw
  process.stdout.write('survived\n');
  process.exit(0);
}

// captureSync's WriteResult must report a DROPPED write on a degraded sink: a
// per-invocation process can then choose to exit non-zero instead of exiting blind.
if (scenario === 'manual-sync-status-broken') {
  const { captureSync } = install({ file, bootCheck: false });
  const res = captureSync(new Error('dropped'));
  process.stdout.write(JSON.stringify(res) + '\n'); // expect {"ok":false,"errno":...}
  process.exit(0);
}

const exitOnUncaught = exitFlag !== 'false';
const exitOnRejection = scenario === 'rejection-fatal';
const withContext = scenario !== 'manual-bare';
// 'uncaught-nofile' installs a stderr sink (no file) to prove the fatal breadcrumb
// is suppressed there — the record is already on stderr, so no double-print.
const { capture, captureSync } = install({
  file: scenario === 'uncaught-nofile' ? undefined : file,
  context: withContext ? { app: 'fix', release: 'v1' } : undefined,
  exitOnUncaught,
  exitOnRejection,
  // 'uncaught-degraded': a bad path with bootCheck:false → the sink degrades instead
  // of throwing at boot, so the fatal write is dropped and the breadcrumb must say so.
  bootCheck: scenario !== 'uncaught-degraded',
  maxBytes: 0, // rotation is M2's concern; keep it out of these tests
});

// Idempotency: a second install must not stack a second handler pair.
if (scenario === 'double-install') {
  install({ file, context: { app: 'fix', release: 'v1' }, maxBytes: 0 });
  process.stdout.write(JSON.stringify({
    uncaught: process.listenerCount('uncaughtException'),
    rejection: process.listenerCount('unhandledRejection'),
  }) + '\n');
  Promise.reject(new Error('rejected boom'));
  await waitFor(() => lineCount() >= 1);
  await new Promise((r) => setTimeout(r, 60)); // let any (buggy) duplicate land
  process.exit(0);
}

switch (scenario) {
  case 'manual':
    capture(new Error('manual boom'), { where: 'unit' });
    await waitFor(() => lineCount() >= 1);
    process.exit(0);
    break;
  case 'manual-bare': // no install context, no extra → default-out check
    capture(new Error('bare boom'));
    await waitFor(() => lineCount() >= 1);
    process.exit(0);
    break;
  case 'manual-sync':
    // The adopter's Problem 1: capture-then-exit. captureSync must land the line
    // BEFORE an immediate exit — no event-loop turn, no await, no waitFor.
    captureSync(new Error('sync boom'), { where: 'exit' });
    process.exit(7); // adopter-chosen code: proves the exit policy stays the caller's
    break;
  case 'manual-sync-status': {
    // captureSync returns its WriteResult; on a healthy sink that's { ok:true }.
    const res = captureSync(new Error('sync status boom'));
    process.stdout.write(JSON.stringify(res) + '\n');
    process.exit(0);
    break;
  }
  case 'rejection':
    Promise.reject(new Error('rejected boom'));
    await waitFor(() => lineCount() >= 1); // reaching here at all proves no crash
    process.exit(0);
    break;
  case 'rejection-fatal':
    // exitOnRejection:true → handler writeSyncs then exit(1). Keep the loop alive
    // so the rejection is delivered; the handler exits well before this fires.
    Promise.reject(new Error('rejected fatal'));
    setTimeout(() => process.exit(3), 2000); // safety net: distinct code if handler never ran
    break;
  case 'uncaught': // exitOnUncaught default true → handler logs (sync) then exit(1)
    setTimeout(() => { throw new Error('uncaught boom'); }, 10);
    break;
  case 'uncaught-nofile': // no file → stderr sink; fatal handler must NOT breadcrumb
    setTimeout(() => { throw new Error('nofile boom'); }, 10);
    break;
  case 'uncaught-broken-stderr':
    // A broken stderr must not throw out of the fatal handler or change the exit
    // code. Break stderr AFTER the file write path is proven healthy, then throw.
    process.stderr.write = () => { throw new Error('stderr gone'); };
    setTimeout(() => { throw new Error('broken stderr boom'); }, 10);
    break;
  case 'uncaught-degraded': // bad path + bootCheck:false → write dropped, breadcrumb says so
    setTimeout(() => { throw new Error('degraded boom'); }, 10);
    break;
  case 'uncaught-controlchars':
    // Attacker-influenced message with CR + ESC + LF: the breadcrumb must render them
    // as \xNN and stay one physical line (no terminal spoof, no forged log line).
    setTimeout(() => { throw new Error('boom\r\x1b[2K\ninjected'); }, 10);
    break;
  case 'uncaught-nonerror': // non-Error throw exercises normalize integration
    setTimeout(() => { throw 'string boom'; }, 10);
    break;
  default:
    process.stderr.write(`fixture: unknown scenario ${scenario}\n`);
    process.exit(2);
}
