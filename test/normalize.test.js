// M1 — unit tests for normalize(value, kind, context) → record.
// Pure, no I/O. Locks the record shape (PRD §6), the non-Error/missing-stack
// behaviour (PRD §9.9 M1), the boundary-anchored stack (POC finding), and the
// default-out-on-context invariant (PRD §3.6).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalize } from '../src/normalize.js';

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

test('Error input: carries name/message/stack from the Error', () => {
  const err = new TypeError('boom');
  const rec = normalize(err, 'manual', {});
  assert.equal(rec.kind, 'manual');
  assert.equal(rec.name, 'TypeError');
  assert.equal(rec.message, 'boom');
  assert.equal(rec.stack, err.stack); // the real stack, untouched
  assert.match(rec.ts, ISO);
});

test('empty context: record has exactly the five core keys, in order', () => {
  const rec = normalize(new Error('x'), 'uncaught', {});
  assert.deepEqual(Object.keys(rec), ['ts', 'kind', 'name', 'message', 'stack']);
});

test('no context arg behaves like empty context (no harvested fields)', () => {
  const rec = normalize(new Error('x'), 'uncaught');
  assert.deepEqual(Object.keys(rec), ['ts', 'kind', 'name', 'message', 'stack']);
});

test('non-Error string: message is the string verbatim, name is Error', () => {
  const rec = normalize('just a string', 'uncaught', {});
  assert.equal(rec.name, 'Error');
  assert.equal(rec.message, 'just a string');
  assert.ok(rec.stack, 'a stack is synthesized');
});

test('non-Error object: payload preserved as JSON (nothing disappears)', () => {
  const rec = normalize({ code: 42, detail: 'nope' }, 'manual', {});
  assert.equal(rec.message, '{"code":42,"detail":"nope"}');
  assert.ok(rec.stack);
});

test('non-Error null and undefined: stringified, never throws', () => {
  assert.equal(normalize(null, 'manual', {}).message, 'null');
  assert.equal(normalize(undefined, 'manual', {}).message, 'undefined');
});

test('circular non-Error object: falls back to String, never throws', () => {
  const o = {};
  o.self = o;
  const rec = normalize(o, 'manual', {});
  assert.equal(rec.message, '[object Object]');
  assert.ok(rec.stack);
});

test('missing-stack Error: synthesizes a stack', () => {
  const err = new Error('no stack here');
  delete err.stack;
  const rec = normalize(err, 'uncaught', {});
  assert.ok(rec.stack, 'stack is synthesized when the Error has none');
  assert.match(rec.stack, /no stack here/);
});

test('synthesized stack is anchored at the caller, not flightlog internals', () => {
  function callerBoundary() {
    return normalize('thrown value', 'uncaught', {});
  }
  const rec = callerBoundary();
  // The POC bug: stack pointed into normalize(). It must not.
  assert.doesNotMatch(rec.stack, /at normalize\b/);
  assert.doesNotMatch(rec.stack, /normalize\.js/);
  // It should anchor at the boundary that called normalize.
  assert.match(rec.stack, /callerBoundary/);
});

test('context is spread after the core fields (PRD §6 shape)', () => {
  const rec = normalize(new Error('x'), 'manual', { app: 'addypin', release: 'v1.4.2' });
  assert.deepEqual(Object.keys(rec), [
    'ts', 'kind', 'name', 'message', 'stack', 'app', 'release',
  ]);
  assert.equal(rec.app, 'addypin');
  assert.equal(rec.release, 'v1.4.2');
});

test('record is flat and JSON-serializable (the JSONL is the interface)', () => {
  const rec = normalize(new TypeError('boom'), 'manual', { app: 'x', n: 1 });
  const round = JSON.parse(JSON.stringify(rec));
  assert.deepEqual(round, rec); // no circulars, no undefined-only fields, all strings/scalars
});
