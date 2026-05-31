// Shared JSDoc typedefs — the single source of cross-file shapes. tsc generates
// types/*.d.ts from these; no hand-written .d.ts exists, so types can't drift
// from the code (PRD §9.3). This file holds no runtime code.

/**
 * Options for {@link install}.
 * @typedef {Object} InstallOptions
 * @property {string} [file]  Path to the JSONL sink. Omit → write to stderr (no
 *   rotation, no boot check). The parent directory is created at install.
 * @property {Object<string, unknown>} [context]  Static fields merged into every
 *   record. Adopter-chosen — flightlog never auto-harvests anything.
 * @property {boolean} [exitOnUncaught=true]  On an uncaught exception: log
 *   synchronously, then `process.exit(1)`. `false` → log and stay alive.
 * @property {number} [maxBytes=5000000]  Rotate when a write would cross this size;
 *   `0` disables rotation.
 */

/**
 * One normalized error record — the shape of a single JSONL line. Core fields are
 * always present; any additional keys are adopter-supplied context.
 * @typedef {Object} LogRecord
 * @property {string} ts  ISO 8601 timestamp.
 * @property {('uncaught'|'unhandledRejection'|'manual')} kind  How it was caught.
 * @property {string} name  Error name (or `"Error"` for a non-Error throw).
 * @property {string} message  Error message (described faithfully for non-Errors).
 * @property {string} stack  Real stack, or one synthesized at the call boundary.
 */

export {}; // mark this as a module so the typedefs are importable, not global
