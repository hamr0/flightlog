```
   uncaught   ─┐
   rejected   ─┤   ╭───────────────╮      errors.jsonl
   capture()  ─┴─▶ │ ▓ flight log ▓ │ ─▶  {"ts":…,"kind":"uncaught",…}
                   ╰───────────────╯       {"ts":…,"kind":"manual",…}
                  survives the crash       {"ts":…,"kind":"unhandledRejection",…}
                  · readable anytime

   flightlog
```

> A flight recorder for your app. Catches what would otherwise vanish — uncaught exceptions, unhandled rejections, and errors you hand it — and writes each as **one JSON line** to a local file you can read anytime, even on a healthy app.
> ~130 lines of code, **zero** production dependencies. The JSONL *is* the interface.

<p align="center">
  <a href="https://github.com/hamr0/flightlog/actions/workflows/ci.yml"><img src="https://github.com/hamr0/flightlog/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <img src="https://img.shields.io/github/package-json/v/hamr0/flightlog?label=version&color=2a4f8c" alt="version (auto from package.json)">
  <img src="https://img.shields.io/badge/license-Apache%202.0-2a4f8c" alt="license: Apache 2.0">
</p>

---

## What this is

flightlog is the ~20-line global error net — packaged once, audited, so it wires into every app the same way. `install()` once: it registers the handlers, runs a boot-time writability check, and hands you `capture()` (async) plus `captureSync()` (for log-then-exit in short-lived processes). Every uncaught exception, unhandled rejection, and value you pass to `capture()` becomes one normalized JSONL line.

Same build ethos as the bare suite — embed it, don't run it; zero deps; no daemon, no SaaS, no telemetry — but flightlog is **substrate for your own apps**, not agent infrastructure. Closest sibling: [mailproof](https://github.com/hamr0/mailproof).

It owns exactly one layer: *catch → normalize → append*. It is **not** a general logger (no info/warn levels — that's pino/winston), **not** aggregation or dedup (that's `jq` when you need it), **not** breadcrumbs or auto-captured context (the surveillance payload a privacy tool refuses), and ships **no UI, server, or reader** — the JSONL is the whole read surface. It never harvests context: it logs only what you hand it.

## Install

```
npm install flightlog
```

**ESM-only.** ESM consumers (`import`) need Node.js **>= 18**. CommonJS consumers (`require`) need Node **>= 22.12** (`require(esm)`) or `await import("flightlog")` — see the [integration guide](flightlog.context.md#module-format--esm-only). **Zero production dependencies** (vanilla + `node:fs`). Ships TypeScript types generated from JSDoc — `import { install } from "flightlog"` gives you autocomplete out of the box, no `@types` package needed.

## Quick start

```js
import { install } from "flightlog";

const { capture, captureSync } = install({
  file: "/var/log/myapp/errors.jsonl",         // sink; omit → stderr
  context: { app: "myapp", release: "v1.4.2" }, // static, you choose — never auto-harvested
  exitOnUncaught: true,                         // default; false = log-and-stay-alive (CLI/desktop)
  exitOnRejection: false,                       // default; true = fatal rejections (short-lived procs)
  bootCheck: true,                              // default; false = warn (don't throw) if sink unwritable
  maxBytes: 5_000_000,                          // default 5 MB; 0 disables rotation
});

// Operational errors you catch at a boundary — the request fails, the server stays up:
try { await risky(); } catch (err) { capture(err, { where: "checkout", userId }); }

// Short-lived process (CLI/cron/pipe) that logs-then-exits — use the sync sibling:
try { main(); } catch (err) { captureSync(err, { where: "receive" }); process.exit(1); }
```

That's the whole wiring. Uncaught exceptions log synchronously then `exit(1)` (your supervisor restarts clean); unhandled rejections log and stay alive (set `exitOnRejection: true` to make them fatal); `capture()` is fire-and-forget while `captureSync()` flushes before you exit; neither throws.

**Wiring it into a real app?** Hand your AI assistant the integration guide and describe what you want:

```
Read flightlog.context.md from node_modules/flightlog/flightlog.context.md,
then wire flightlog into my app. Here's my setup: <describe app, log path, context>.
```

That file has every option, the full record shape, the crash policy, the rejection gotcha, the threat model, and the `jq` / `tail` reading recipes.

## The record

One flat JSON object per error — `kind` is how it was caught, everything after `stack` is context you supplied:

```json
{"ts":"2026-05-31T12:00:00.000Z","kind":"uncaught","name":"TypeError","message":"x is not a function","stack":"…","app":"myapp","release":"v1.4.2"}
```

| What | Behavior |
|---|---|
| **uncaught exception** | log synchronously → `exit(1)` (unless `exitOnUncaught: false`) so a supervisor restarts a clean process |
| **unhandled rejection** | log only — *intentionally suppresses Node's default crash-on-rejection*; a stray rejection shouldn't down a server. Set `exitOnRejection: true` to log (sync) then `exit(1)` for short-lived processes |
| **manual `capture(err, extra?)`** | normalize + append `{ ...context, ...extra }`; async/fire-and-forget; never throws, never exits |
| **manual `captureSync(err, extra?)`** | same record, written **synchronously** so it survives a `process.exit()` right after — for log-then-exit in short-lived processes. Returns `{ ok, errno? }` so a per-invocation process can tell "logged" from "silently dropped" and set its exit code; ignorable otherwise |
| **non-Error throws** (`throw "x"`, objects, `null`) | described faithfully, given a stack synthesized at the *call site* — not flightlog's internals |
| **disk growth** | size cap + rotation: at `maxBytes` the file rolls to `.1` (current + one previous, bounded ~2×). `0` disables |
| **broken sink** (perms / read-only / full disk) | swallowed — never crashes your app — and surfaced once to stderr with the errno, reset on recovery |
| **boot-time check** | `install()` probes the sink and, by default, throws on a bad path — fail loud at startup. `bootCheck: false` warns-once instead, for short-lived/per-invocation processes (cron, mail pipes) where a fatal boot would take down the real work |
| **file perms** | created `0600` (owner-only) so error data isn't world-readable on a shared host |

34 tests pass on CI (Node 22): unit (`normalize` on every throw shape), integration (rotation, self-failure warn-once, boot check, `0600` perms), subprocess (the crash policy, each `kind`, `captureSync` surviving an immediate exit, `exitOnRejection`, and `bootCheck: false` surviving an unwritable sink end to end), and a **packed-tarball E2E** that extracts the real artifact and imports it by bare specifier.

## Docs

| | |
|---|---|
| **[Integration Guide](flightlog.context.md)** | The complete adopter contract — options, API, record shape, gotchas, threat model. Hand it to your AI assistant. |
| **[Examples](examples/)** | [`read.js`](examples/read.js) — zero-dep reader recipes (filter by `kind`/`where`/`proc`, tail) that print their `jq` equivalents; [`ship.js`](examples/ship.js) — a consent-gated uploader for shipping the JSONL back to yourself. The layers flightlog won't do. Both *(repo-only)* — copy and adapt. |
| **[PRD](docs/01-product/2026-05-31-prd.md)** | Locked decisions + *why*, success criteria, the refusals, build order. *(repo-only)* |
| **[CHANGELOG](CHANGELOG.md)** | keep-a-changelog; an entry every release. |

## flightlog + pulselog — a lightweight server-log suite

Two halves of one observability story for apps you run yourself: a **zero-dep,
self-hosted alternative to Sentry and hosted analytics/uptime monitoring**. Same
JSONL dialect, so one `tail` / `jq` / uploader spans both. Embed flightlog
*inside* the app; schedule [pulselog](https://github.com/hamr0/pulselog) *outside* it.

| | [flightlog](https://github.com/hamr0/flightlog) | [pulselog](https://github.com/hamr0/pulselog) |
|---|---|---|
| **Vantage** | inside the app (in-process) | outside, scheduled watcher |
| **Answers** | what broke | is it up · how it's trending · is it safe |
| **Captures** | uncaught errors, rejections, `capture()` | health · weekly stats · rotated backups |
| **Runs** | embedded, fires on every error | cron — health 5m · digest weekly · backup nightly |
| **Output** | one JSONL line per error | one JSONL line per result (same dialect) |
| **Replaces** | Sentry, Rollbar, Bugsnag | hosted analytics, Pingdom, UptimeRobot |

## License

Apache 2.0. See [LICENSE](LICENSE).
