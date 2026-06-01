# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Docs: `flightlog.context.md` now opens with a **What flightlog is and is not**
  section, putting the is/not boundary in the first screenful (per
  `LIBRARY_CONVENTIONS.md` §3) instead of only at the refusals section below.
- Docs: `examples/README.md` documenting what `examples/ship.js` is and does
  (GitHub renders it when browsing the folder), and a **Examples** row in the
  README Docs table so the reference uploader is discoverable from the front
  page, not just from `context.md`. Repo-only, as before.
- `examples/read.js`: a zero-dep, repo-only reference reader (the symmetric
  sibling to `ship.js`) — streams the JSONL and filters by `kind` / field
  `match` / `since` / `tail`, skips torn lines, and prints the `jq` equivalent
  under each result so adopters graduate off it. Carries the operator read
  discipline; not shipped in the package. (PRD §15.3 — second-adopter feedback
  from plato.)
- Docs: two new gotchas in `flightlog.context.md`, both surfaced by the plato
  integration (PRD §15) so adopters don't re-hit them — **strip the query string
  when logging a web request** (flightlog never redacts; secrets in the URL would
  hit disk, and a shipped `safePath()` is a refused footgun), and **tag
  multi-process sinks with a `proc` key** (convention, not API; flightlog has no
  built-in process identity). The corresponding refusals are recorded in
  repo-only `CLAUDE.md`.

## [0.3.1] - 2026-05-31

Documentation only — no code or behavior change.

### Fixed
- Docs: `flightlog.context.md` **API** section was stale — it still showed
  `install(opts?) → { capture }` and "returns `capture`" after `captureSync` was
  added in 0.2.0. Now `{ capture, captureSync }`, with the `bootCheck: false`
  boot-throw caveat noted.

### Changed
- Docs: added a `bootCheck: false` gotcha (fail-loud vs silent degradation);
  de-anchored the context.md status line from a specific version. README: removed
  the "Where this sits" section.

## [0.3.0] - 2026-05-31

Additive, backward-compatible — second-round `gitdone` feedback (per-message
Postfix pipe) plus a repo-only uploader example. See PRD §14.1.

### Added
- **`bootCheck`** install option (default `true`). When `false`, an unwritable
  `file` at install is **not fatal**: `install()` warns once to stderr and the sink
  degrades to its normal swallow-on-write behavior instead of throwing. For
  short-lived/per-invocation processes (cron, mail pipes) where a fatal boot would
  take down the real work, not just the error sink — e.g. a Postfix pipe whose
  non-zero exit would defer all mail. Default `true` preserves the fail-loud-at-boot
  behavior. Mirrors `exitOnUncaught` / `exitOnRejection`.
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

[Unreleased]: https://github.com/hamr0/flightlog/compare/v0.3.1...HEAD
[0.3.1]: https://github.com/hamr0/flightlog/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/hamr0/flightlog/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/hamr0/flightlog/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/hamr0/flightlog/compare/v0.0.1...v0.1.0
[0.0.1]: https://github.com/hamr0/flightlog/releases/tag/v0.0.1
