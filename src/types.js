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
 * @property {boolean} [exitOnRejection=false]  On an unhandled rejection: log
 *   synchronously, then `process.exit(1)`. Default `false` keeps a rejection
 *   log-only (and suppresses Node's default crash) — set `true` for short-lived
 *   processes that must die non-zero on a stray rejection.
 * @property {boolean} [bootCheck=true]  Whether an unwritable `file` at install is
 *   fatal. `true` (default) → `install()` throws, failing loud at startup. `false`
 *   → warn once to stderr and continue (the sink degrades to swallow-on-write) —
 *   for short-lived/per-invocation processes (cron, mail pipes) where a fatal boot
 *   would take down the real work, not just the error sink.
 * @property {number} [maxBytes=5000000]  Rotate when a write would cross this size;
 *   `0` disables rotation.
 */

/** How an error reached flightlog. @typedef {('uncaught'|'unhandledRejection'|'manual')} Kind */

/**
 * What a **synchronous** write reports back — returned by {@link captureSync} so a
 * short-lived process can tell "landed on disk" from "silently dropped" (the sink
 * swallows write failures, so there is otherwise no in-process signal). The async
 * {@link capture} is fire-and-forget and deliberately returns nothing — an async
 * write can't report a result synchronously, and a Promise would re-introduce the
 * await-footgun `captureSync` exists to avoid.
 * @typedef {Object} WriteResult
 * @property {boolean} ok  `true` if the line was written; `false` if the write was
 *   swallowed (broken sink — perms/disk/quota, or a degraded `bootCheck:false` sink).
 * @property {string} [errno]  The failure errno when the OS provided one (e.g.
 *   `'EACCES'`, `'EROFS'`, `'ENOSPC'`); present only when `ok` is `false`.
 */

/**
 * One normalized error record — the shape of a single JSONL line. Core fields are
 * always present; any additional keys are adopter-supplied context.
 * @typedef {Object} LogRecord
 * @property {string} ts  ISO 8601 timestamp.
 * @property {Kind} kind  How it was caught.
 * @property {string} name  Error name (or `"Error"` for a non-Error throw).
 * @property {string} message  Error message (described faithfully for non-Errors).
 * @property {string} stack  Real stack, or one synthesized at the call boundary.
 */

export {}; // mark this as a module so the typedefs are importable, not global
