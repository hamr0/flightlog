// M1 — normalize any thrown value into a flat, JSON-safe record. Pure, zero I/O.
// The record is the line that lands in the JSONL sink (PRD §6). Context is spread
// in but NEVER auto-harvested: flightlog logs only what the adopter passed.

/**
 * Render a non-Error thrown value into a faithful message string. A debugging
 * tool must not drop what was thrown, so objects are JSON-serialized (with a
 * String() fallback for circular/unserializable values) rather than collapsed
 * to "[object Object]" eagerly.
 * @param {unknown} value
 * @returns {string}
 */
function describe(value) {
  if (typeof value === 'string') return value;
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  try {
    const json = JSON.stringify(value);
    return json === undefined ? String(value) : json;
  } catch {
    return String(value);
  }
}

/**
 * Synthesize a stack for a value that has none (non-Error throws, or an Error
 * whose `.stack` was stripped). `Error.captureStackTrace(e, normalize)` excludes
 * normalize's own frames, so the trace anchors at normalize's *caller* — the
 * capture boundary — instead of pointing into flightlog internals (the POC bug).
 * @param {string} name
 * @param {string} message
 * @returns {string}
 */
function synthesizeStack(name, message) {
  const carrier = new Error(message);
  carrier.name = name;
  if (typeof Error.captureStackTrace === 'function') {
    Error.captureStackTrace(carrier, normalize);
  }
  return carrier.stack ?? `${name}: ${message}`;
}

/**
 * Normalize any thrown value into a flat record ready to serialize as one JSONL
 * line. Error instances keep their real name/message/stack; anything else is
 * described and given a boundary-anchored synthetic stack.
 *
 * @param {unknown} value   The thrown value (Error or not).
 * @param {('uncaught'|'unhandledRejection'|'manual')} kind  How it was caught.
 * @param {Object} [context]  Adopter-supplied fields, spread in after the core
 *   fields. Already-merged by the caller (static + per-call extra); normalize
 *   never harvests anything on its own.
 * @returns {{ ts: string, kind: string, name: string, message: string, stack: string }
 *   & Object}
 */
export function normalize(value, kind, context = {}) {
  const isError = value instanceof Error;
  const name = isError ? value.name : 'Error';
  const message = isError ? value.message : describe(value);
  const stack = (isError && value.stack) ? value.stack : synthesizeStack(name, message);

  return {
    ts: new Date().toISOString(),
    kind,
    name,
    message,
    stack,
    ...context, // adopter-supplied only — last, per the locked record shape (PRD §6)
  };
}
