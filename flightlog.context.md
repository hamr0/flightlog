# flightlog — adopter contract

A flight recorder for your app. `install()` it once; every uncaught exception,
unhandled rejection, and value you hand to `capture()` lands as **one JSON line**
in a local JSONL file you can read at any time — even on a healthy app — to see
where things have failed. Zero production dependencies (vanilla + `node:fs`).

This file is the complete contract: every option, the whole API, what flightlog
deliberately does **not** do, the gotchas, and the threat model. If you read one
file before adopting, read this one.

> **Status:** `0.1.0` is the first functional release. `0.0.1` is a name
> placeholder that throws on import — don't depend on it.

## Install

```js
import { install } from 'flightlog';

const { capture } = install({
  file: '/var/log/myapp/errors.jsonl',         // sink; omit → stderr
  context: { app: 'myapp', release: 'v1.4.2' }, // static, you choose
  exitOnUncaught: true,                         // default
  maxBytes: 5_000_000,                          // default 5 MB; 0 disables rotation
});

try { risky(); } catch (err) { capture(err, { where: 'checkout', userId }); }
```

Three lines wire a whole app: import, `install`, and a `capture` at any boundary
you want to survive without crashing.

## Options

| Option | Type | Default | Meaning |
|---|---|---|---|
| `file` | `string` | — | Path to the JSONL sink. **Omit → writes to stderr** (no rotation, no boot check). The parent directory is created (`mkdir -p`) at install. |
| `context` | `object` | `{}` | Static fields merged into **every** record. You choose these — flightlog never auto-harvests anything (see Refusals). |
| `exitOnUncaught` | `boolean` | `true` | On an uncaught exception: log synchronously, then `process.exit(1)` so a supervisor restarts you clean. Set `false` for CLIs/desktop apps that should log-and-stay-alive. |
| `maxBytes` | `number` | `5_000_000` | Rotate the file when a write would cross this size. `0` disables rotation. |

## API

- **`install(opts?) → { capture }`** — registers the global handlers, runs the
  boot-time writability check (throws *now* if `file`'s path can't be written),
  and returns `capture`.
- **`capture(err, extra?) → void`** — normalize any thrown value and append one
  line, merging `{ ...context, ...extra }` (per-call `extra` wins on key clashes).
  Never throws.

## Record shape

```json
{"ts":"2026-05-31T12:00:00.000Z","kind":"uncaught","name":"TypeError","message":"x is not a function","stack":"TypeError: x is not a function\n    at ...","app":"myapp","release":"v1.4.2"}
```

- `ts` — ISO 8601 timestamp.
- `kind` — `uncaught` | `unhandledRejection` | `manual`.
- `name` / `message` / `stack` — from the Error. A **non-Error throw** (string,
  object, `null`) is described faithfully (objects are JSON-serialized so the
  payload isn't lost) and given a synthetic stack anchored at the call site, not
  flightlog's internals.
- Everything after `stack` is **your context only** — `{ ...context, ...extra }`.

## Behavior

- **Crash policy.** Operational errors you catch and `capture()` fail one request
  and keep the server up. An *uncaught* exception means the event loop is in an
  unknown state: flightlog logs it synchronously and exits `1` (unless
  `exitOnUncaught: false`) so your supervisor (systemd/Docker/pm2) restarts a
  clean process. flightlog has **no restart logic of its own** — backoff on a
  crash-loop is the supervisor's job.
- **Write mode.** Normal path is async (`appendFile`) so a single error never
  freezes the server. The uncaught→exit path writes **synchronously** so the
  final line is flushed before the process dies.
- **Rotation.** At `maxBytes` the current file is renamed to `<file>.1` (the old
  `.1` is discarded) and a fresh file starts. You keep the current file plus one
  previous segment — disk is bounded at **~2× `maxBytes`**, forever, with zero
  config. No compression, no dated archives, no retention windows.
- **Self-failure.** A write that fails (bad perms, read-only fs, full disk, quota)
  is **swallowed — flightlog never crashes your app** — but the first failure
  emits exactly one line to stderr naming the errno (e.g. `EACCES`, `EROFS`,
  `ENOSPC`). It stays quiet after that until a write succeeds again, then a later
  failure will warn again. The stderr write is itself wrapped, so even a broken
  stderr can't turn the logger into the bug.
- **Boot-time check.** `install()` creates the parent dir and probes a write
  immediately, so a misconfigured path fails **loudly at startup**, not silently
  at your first real error.

## Gotchas

- **Unhandled rejections are logged but do NOT exit — and this suppresses Node's
  own default crash-on-rejection.** That is intentional: a stray un-awaited
  rejection shouldn't take a whole server down. If you *want* a rejection to crash
  the process, convert it to an uncaught exception yourself (e.g. rethrow in a
  top-level handler). Only `uncaught` exits (and only when `exitOnUncaught` is on).
- **A single line larger than `maxBytes`** is still written whole (JSONL lines are
  never split); rotation happens before it, so that one oversized line briefly
  lives in an otherwise-fresh file.
- **`capture()` is fire-and-forget on the async path.** It returns before the line
  is durably on disk. The death path (uncaught) is synchronous precisely so the
  last line survives the exit.
- **`install()` is idempotent.** Call it more than once (hot-reload, tests, two
  entry points) and the latest call wins: it swaps in the new options and rebinds
  `capture` without stacking a second handler pair — so errors are never logged
  twice and process listeners don't leak.

## What flightlog will not do (the refusals *are* the product)

- **No aggregation / dedup / counts** — scale-gated; `jq` covers it when you need it.
- **No breadcrumbs / auto-captured context** — the surveillance payload a privacy
  tool refuses. **Default-out on context, always:** flightlog logs only what you
  pass to `install({ context })` / `capture(err, extra)`.
- **No UI, no server, no reader** — the JSONL *is* the interface. Read it with
  `tail`, `jq`, or your editor.
- **No symbolication / alerting / release tracking** — team-and-scale process.
- **Not a general logger** — errors only, no info/warn levels.
- **No restart logic** — that's your supervisor's job.

## Threat model

flightlog never harvests context — but the JSONL **will** contain whatever you
pass to `install({ context })` / `capture(err, extra)`, plus error messages and
stacks that can incidentally include sensitive strings. Therefore:

- You own what goes into context. Don't pass secrets you wouldn't want on disk.
- The log file inherits the sensitivity of its contents. flightlog creates it
  **`0600` (owner read/write only)** by default so it isn't group/world-readable on
  a shared host. The mode applies only at creation — an existing file keeps its
  perms, and you can `chmod` if you need it more permissive. Still keep it off
  shared/world-readable *paths*; flightlog can't set perms it doesn't create.

"Local + private" means *it never phones home* — not *it's safe to put secrets in*.

## Reading the log

```sh
tail -f /var/log/myapp/errors.jsonl                       # live tail
jq -r 'select(.kind=="uncaught") | "\(.ts) \(.message)"' errors.jsonl
jq -s 'group_by(.name) | map({name: .[0].name, n: length})' errors.jsonl  # ad-hoc counts
```
