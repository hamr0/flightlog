# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Planned for `0.1.0` — first functional release (see `docs/01-product` PRD):

### Added
- `install(opts?) → { capture }` — registers global handlers for
  `uncaughtException` (log, then `exit(1)` unless `exitOnUncaught: false`) and
  `unhandledRejection` (log only), runs a boot-time writability check, and
  returns a manual `capture(err, extra?)`.
- JSONL sink: one normalized record per error
  (`ts`, `kind`, `name`, `message`, `stack`, + adopter-supplied context only).
- Built-in size cap + rotation (`maxBytes`, default 5 MB / `5_000_000` bytes;
  `0` disables). At the cap the current file rolls to `.1` (keeping current + one
  previous, so disk is bounded at ~2× `maxBytes`).
- Self-failure handling: swallow (never crash the app) + warn-once-to-stderr.
- JSDoc → generated `.d.ts`; `flightlog.context.md` adopter contract.

## [0.0.1] - 2026-05-31

### Added
- Name-reservation placeholder published to npm. No functional API yet — the
  package throws on import directing users to the repo. Reserves `flightlog`
  while `0.1.0` is built.

[Unreleased]: https://github.com/hamr0/flightlog/compare/v0.0.1...HEAD
[0.0.1]: https://github.com/hamr0/flightlog/releases/tag/v0.0.1
