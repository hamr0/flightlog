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

const exitOnUncaught = exitFlag !== 'false';
const withContext = scenario !== 'manual-bare';
const { capture } = install({
  file,
  context: withContext ? { app: 'fix', release: 'v1' } : undefined,
  exitOnUncaught,
  maxBytes: 0, // rotation is M2's concern; keep it out of these tests
});

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
  case 'rejection':
    Promise.reject(new Error('rejected boom'));
    await waitFor(() => lineCount() >= 1); // reaching here at all proves no crash
    process.exit(0);
    break;
  case 'uncaught': // exitOnUncaught default true → handler logs (sync) then exit(1)
    setTimeout(() => { throw new Error('uncaught boom'); }, 10);
    break;
  case 'uncaught-nonerror': // non-Error throw exercises normalize integration
    setTimeout(() => { throw 'string boom'; }, 10);
    break;
  default:
    process.stderr.write(`fixture: unknown scenario ${scenario}\n`);
    process.exit(2);
}
