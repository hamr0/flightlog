// POC validation: happy path + 3 common cases. Run: node poc/demo.js ; cat poc/errors.jsonl
import { install } from './barecatch.js';

const { capture } = install({
  file: new URL('./errors.jsonl', import.meta.url).pathname,
  context: { app: 'demo', release: 'poc-0' },   // adopter-chosen, static
  exitOnUncaught: false,                          // POC: keep running so we hit every case
});

// Case 1: manual capture of a handled error (the intentional local try/catch path)
try {
  JSON.parse('{not json}');
} catch (err) {
  capture(err, { where: 'config-parse' });
}

// Case 2: a non-Error thrown value (common footgun — strings, objects)
capture('plain string blew up', { where: 'legacy-code' });

// Case 3: an unhandled promise rejection (escapes try/catch entirely)
Promise.reject(new Error('db connection lost'));

// Case 4: a truly uncaught exception, async so the rejection above flushes first
setTimeout(() => {
  const u = undefined;
  u.toString();   // TypeError, nobody catches it
}, 10);
