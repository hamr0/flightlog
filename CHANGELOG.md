# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Repo-only `examples/ship.js`: a complete, zero-dep, consent-gated reference
  uploader for shipping the JSONL to a server you control — the transport layer
  flightlog deliberately does not provide. Not shipped in the package, not a
  dependency; copy and adapt.

### Changed
- Docs: `flightlog.context.md` states plainly that flightlog never uploads and
  points to `examples/ship.js` for a build-it-yourself, consent-gated uploader.

## [0.2.0] - 2026-05-31

Additive, backward-compatible — driven by first-adopter (`gitdone`) integration
feedback on short-lived processes (see PRD §14).

### Added
- **`captureSync(err, extra?)`** — returned from `install()` alongside `capture`.
  A manual capture that writes the line **synchronously** before returning, for
  short-lived processes (CLIs, cron, pipe transports) that capture-then-exit, where
  the async `capture()` line is lost when `process.exit()` kills the event loop
  before the append flushes. Same record/merge as `capture`; never throws. The
  exit-code decision stays the adopter's. *(Surfaces the sink's existing sync
  writer — no new mechanism, no new dependency.)*
- **`exitOnRejection`** install option (default `false`). When `true`, an unhandled
  rejection is logged **synchronously** and then `process.exit(1)` — so a
  short-lived process can die non-zero on a stray rejection instead of the
  default silent exit-0. Default `false` preserves today's log-only behavior
  (and the suppression of Node's default crash) for long-lived servers. Mirrors
  `exitOnUncaught`.

### Changed
- Docs: `flightlog.context.md` now states the **Node.js ≥ 18** requirement and
  that TypeScript types ship (no `@types` package needed), and recommends calling
  `install()` as early as possible so the handlers are registered before other
  code can throw.
- Docs: documented that flightlog is **ESM-only**. CommonJS consumers need Node
  **≥ 22.12** (where `require(esm)` is stable) or `await import('flightlog')`;
  `engines` stays `>=18` because that is the floor for the supported (ESM) path.
  A louder warning that a default unhandled rejection exits the process `0`, with
  a pointer to `exitOnRejection`. Documentation only — no behavior change beyond
  the two additions above.

## [0.1.0] - 2026-05-31

First functional release — the global error net, packaged once (see the PRD in
`docs/01-product`). Zero production dependencies.

### Added
- `install(opts?) → { capture }` — registers global handlers for
  `uncaughtException` (log, then `exit(1)` unless `exitOnUncaught: false`) and
  `unhandledRejection` (log only), runs a boot-time writability check, and
  returns a manual `capture(err, extra?)`. Idempotent: a repeated call replaces
  the handlers (last wins) rather than stacking a second pair.
- JSONL sink: one normalized record per error
  (`ts`, `kind`, `name`, `message`, `stack`, + adopter-supplied context only).
- Built-in size cap + rotation (`maxBytes`, default 5 MB / `5_000_000` bytes;
  `0` disables). At the cap the current file rolls to `.1` (keeping current + one
  previous, so disk is bounded at ~2× `maxBytes`).
- Self-failure handling: swallow (never crash the app) + warn-once-to-stderr.
- JSDoc → generated `.d.ts`; `flightlog.context.md` adopter contract.

### Security
- The log file is created with mode `0600` (owner read/write only) so error data
  isn't group/world-readable by default on a shared host.

## [0.0.1] - 2026-05-31

### Added
- Name-reservation placeholder published to npm. No functional API yet — the
  package throws on import directing users to the repo. Reserves `flightlog`
  while `0.1.0` is built.

[Unreleased]: https://github.com/hamr0/flightlog/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/hamr0/flightlog/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/hamr0/flightlog/compare/v0.0.1...v0.1.0
[0.0.1]: https://github.com/hamr0/flightlog/releases/tag/v0.0.1
