# flightlog — adopter contract

A flight recorder for your app. `install()` it once; every uncaught exception,
unhandled rejection, and value you hand to `capture()` lands as **one JSON line**
in a local JSONL file you can read at any time — even on a healthy app — to see
where things have failed. Zero production dependencies (vanilla + `node:fs`).

This file is the complete contract: every option, the whole API, what flightlog
deliberately does **not** do, the gotchas, and the threat model. If you read one
file before adopting, read this one.

> **Status:** functional since `0.1.0` (see the CHANGELOG for the current release).
> `0.0.1` is a name placeholder that throws on import — don't depend on it.

## What flightlog is and is not

- **It is** a ~zero-dep crash recorder: global handlers + a `capture()` you call,
  each error appended as one line to a local JSONL file, with size-based rotation.
  The local, private alternative to a hosted error-monitoring SaaS.
- **It is not** a general logger, an aggregator, a UI/server/reader, or an
  uploader. It never phones home and never auto-captures context — it logs only
  what you pass it. The full reasoning is in
  [What flightlog will not do](#what-flightlog-will-not-do-the-refusals-are-the-product)
  below.

## Install

```js
import { install } from 'flightlog';

const { capture, captureSync } = install({
  file: '/var/log/myapp/errors.jsonl',         // sink; omit → stderr
  context: { app: 'myapp', release: 'v1.4.2' }, // static, you choose
  exitOnUncaught: true,                         // default
  exitOnRejection: false,                       // default; true = fatal rejections (see Options)
  maxBytes: 5_000_000,                          // default 5 MB; 0 disables rotation
});

try { risky(); } catch (err) { capture(err, { where: 'checkout', userId }); }
```

Three lines wire a whole app: import, `install`, and a `capture` at any boundary
you want to survive without crashing.

**Short-lived process (CLI, cron, pipe transport)?** Use `captureSync` and own the
exit code — the async `capture()` line is lost when you exit before it flushes:

```js
try { main(); } catch (err) { captureSync(err, { where: 'receive' }); process.exit(1); }
```

Ships TypeScript types generated from JSDoc, so `import { install } from 'flightlog'`
gives you autocomplete and type-checking out of the box — no `@types/flightlog`
package needed.

### Module format — ESM-only

flightlog is **ESM-only** (`import`, not `require`). The runtime floor depends on
how you load it:

- **ESM consumers (`import`)** — Node **≥ 18**. This is the supported path.
- **CommonJS consumers (`require`)** — `require('flightlog')` works only on Node
  **≥ 22.12**, where `require(esm)` is stable. On Node 18 / 20 / 22.0–22.11 it
  throws `ERR_REQUIRE_ESM`; use `const { install } = await import('flightlog')`
  instead.

`engines` is `>=18` because that is the floor for the supported (ESM) path; it does
not promise `require()` on every ≥18 release. flightlog will **not** ship a CommonJS
dual-build — the small bit of loader work is the adopter's.

**Call `install()` as early as possible** — ideally the first thing your entry
file does, before other imports or setup can run. The global handlers only catch
what throws *after* they're registered, so the earlier you install, the less can
escape the net during startup.

## Options

| Option | Type | Default | Meaning |
|---|---|---|---|
| `file` | `string` | — | Path to the JSONL sink. **Omit → writes to stderr** (no rotation, no boot check). The parent directory is created (`mkdir -p`) at install. |
| `context` | `object` | `{}` | Static fields merged into **every** record. You choose these — flightlog never auto-harvests anything (see Refusals). |
| `exitOnUncaught` | `boolean` | `true` | On an uncaught exception: log synchronously, then `process.exit(1)` so a supervisor restarts you clean. Set `false` for CLIs/desktop apps that should log-and-stay-alive. |
| `exitOnRejection` | `boolean` | `false` | On an unhandled rejection: log **synchronously**, then `process.exit(1)`. Default `false` keeps rejections log-only (and suppresses Node's default crash). Set `true` for **short-lived processes** (cron, pipe transports) that must die non-zero on a stray rejection instead of silently exiting `0`. See the rejection gotcha below. |
| `bootCheck` | `boolean` | `true` | Whether an unwritable `file` at install is **fatal**. `true` (default) → `install()` throws, failing loud at startup. `false` → warn once to stderr and continue (the sink degrades to swallow-on-write). Set `false` for **short-lived/per-invocation processes** (cron, mail pipes) where a fatal boot would take down the real work, not just the error sink. See the boot-check note below. |
| `maxBytes` | `number` | `5_000_000` | Rotate the file when a write would cross this size. `0` disables rotation. |

## API

- **`install(opts?) → { capture, captureSync }`** — registers the global handlers,
  runs the boot-time writability check (throws *now* if `file`'s path can't be
  written, unless `bootCheck: false`), and returns both capture functions.
- **`capture(err, extra?) → void`** — normalize any thrown value and append one
  line, merging `{ ...context, ...extra }` (per-call `extra` wins on key clashes).
  **Async / fire-and-forget** — returns before the line is durably on disk. Never
  throws.
- **`captureSync(err, extra?) → { ok, errno? }`** — the **synchronous** sibling:
  writes the line before it returns. Same record and merge as `capture`, same
  `manual` kind. Use it when you `capture`-then-`exit` in a short-lived process —
  `capture()`'s line would be lost when `process.exit()` kills the event loop before
  the async append flushes. The exit-code decision stays yours; `captureSync` never
  exits and never throws. It **returns a `WriteResult`** — `{ ok: true }` if the
  line landed, or `{ ok: false, errno }` if the sink swallowed it (broken/degraded
  sink). Ignore it and nothing changes; check it when a per-invocation process needs
  to know "logged" vs "silently dropped" and exit accordingly:
  ```js
  if (!captureSync(err, { where: 'receive' }).ok) process.exitCode = 75; // EX_TEMPFAIL — make the supervisor retry
  process.exit(1);
  ```
  The async `capture()` deliberately returns nothing — it's fire-and-forget by
  design, and a sync status can't describe an async write.

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
  freezes the server. The exit paths — uncaught, a rejection under
  `exitOnRejection`, and `captureSync` — write **synchronously** so the final line
  is flushed before the process dies.
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
  at your first real error. This is the one place flightlog is allowed to crash
  your app — appropriate for a long-lived server (you find out once, at deploy).
  For a **short-lived / per-invocation process** (a cron job, a mail pipe that runs
  once per message) a fatal boot is wrong: an unwritable error sink would take down
  the actual work — e.g. a Postfix pipe exiting non-zero defers *all* mail. Set
  **`bootCheck: false`** there: the boot failure is warned once to stderr and the
  sink degrades to its normal swallow-on-write behavior, so the real work proceeds.
  *(Note: for a mail pipe, deferring is often the safer choice — queued mail is
  retried, not lost — so weigh "defer until fixed" against "deliver without error
  capture" before flipping it.)*

## Gotchas

- **Unhandled rejections are logged but, by default, do NOT exit — and this
  suppresses Node's own default crash-on-rejection, so the process exits `0`.**
  That default is right for a long-lived server: a stray un-awaited rejection
  shouldn't take it down. But it is a **sharp edge for short-lived processes** — a
  cron job or a mail pipe whose top-level is `main().catch(...)` will exit `0` on a
  rejection-class failure, which a caller (e.g. Postfix) reads as *success* and
  silently drops the failed work. For those, set **`exitOnRejection: true`** — the
  rejection is then logged synchronously and the process exits `1`. (Converting the
  rejection to an uncaught exception yourself also works, but `exitOnRejection` is
  the in-library knob.) `exitOnUncaught` governs only the uncaught path.
- **A single line larger than `maxBytes`** is still written whole (JSONL lines are
  never split); rotation happens before it, so that one oversized line briefly
  lives in an otherwise-fresh file.
- **`capture()` is fire-and-forget on the async path.** It returns before the line
  is durably on disk, so a `capture(err); process.exit(1)` loses the line — the
  exit kills the event loop before the append flushes. Use **`captureSync`** when
  you log-then-exit. The death path (uncaught, and rejection under
  `exitOnRejection`) is synchronous precisely so the last line survives the exit.
- **`install()` is idempotent.** Call it more than once (hot-reload, tests, two
  entry points) and the latest call wins: it swaps in the new options and rebinds
  `capture` without stacking a second handler pair — so errors are never logged
  twice and process listeners don't leak.
- **`bootCheck: false` trades fail-loud for silent degradation.** With it off, an
  unwritable sink at boot only warns *once* to stderr; if the path never becomes
  writable, every error after that is silently dropped (the swallow-on-write
  contract) with no further noise. That's the right trade for a short-lived process
  that must not die for a broken *error* sink — but it means you can lose error
  capture without a crash. Keep the default (`true`) for long-lived servers, where
  failing loud at deploy is exactly what you want.
- **Logging a web request? Strip the query string yourself.** flightlog records
  exactly the context you pass and never inspects it — so a tidy-looking
  `capture(err, { where: 'request', method: req.method, path: req.url })` will
  happily write `?token=…` / `?reset=…` secrets that ride in the URL straight to
  disk. Pass a redacted path — `path: req.url.split('?')[0]`, or better your
  router's matched route (`/users/:id`) — and don't pass auth headers or cookies.
  Redaction is the adopter's job **by design**: the threat model puts ownership on
  you, and flightlog deliberately ships no `safePath()`/redaction helper — a
  redactor it shipped would be trusted blindly and silently get *your* scheme
  wrong, which is worse than you owning the strip. (The safe shape:
  `try { ... } catch (err) { capture(err, { where: 'request', method: req.method, path: req.url.split('?')[0], status: 500 }); }`.)
- **One sink, multiple process types? Tag them with `proc`.** If a long-lived
  server and its short-lived siblings (cron jobs, mail pipes) all append to the
  *same* JSONL, nothing distinguishes their lines until you add a field. The
  convention is a `proc` key in each one's static context —
  `install({ context: { proc: 'server' } })`, `{ proc: 'cron' }`,
  `{ proc: 'receive' }` — so you can split them with `jq 'select(.proc=="cron")'`.
  flightlog has **no built-in process identity** (it can't know your topology, and
  a first-class option would just duplicate `context`); `proc` is a naming
  convention, not a special field — pick the same key across your apps so
  cross-app queries line up.
- **Don't spread an untrusted object straight into `context`/`extra`.** Context is
  merged *last* and is **not** protected from clobbering the core fields — a key
  named `ts`, `kind`, `name`, `message`, or `stack` in your context will overwrite
  the real one (`capture(err, { kind: 'manual', stack: 'FAKE' })` → the record's
  `kind`/`stack` become yours). That's intended for deliberate context, but it
  means `capture(err, attackerControlledObject)` lets crafted keys forge the very
  fields you'd trust during an incident. Pass an allow-listed set of fields you
  built, not a raw request/payload object — e.g. `{ where: 'x', userId: u.id }`,
  never `{ ...req.body }`. (Values are always safe: they're JSON-escaped, so a
  newline or fake JSON inside a *value* can't forge a second log line — only your
  own context *keys* can shadow core fields.)

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

**Sending logs to yourself.** flightlog never uploads — it records locally and that
is the end of its job. If you want logs shipped back (e.g. a customer "send
diagnostics" opt-in), build it as a **separate, consent-gated layer that reads the
JSONL** — never fold transport into flightlog. A complete, zero-dep reference
uploader lives in the repo at
[`examples/ship.js`](https://github.com/hamr0/flightlog/blob/main/examples/ship.js)
(repo-only — not shipped in the package, not a dependency). It is consent-gated and
**fails closed on a non-HTTPS endpoint** (error logs must not cross the network in
cleartext). Copy and adapt it; the moment logs land on your server you become the
data controller, so disclose it.

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
