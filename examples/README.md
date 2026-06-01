# examples/

Reference code that is **not part of the package** — repo-only, never in the npm
tarball (`examples/` is excluded from `package.json` `files`), never a dependency.
Copy what you need into your app and adapt it. These carry the disciplines that
live *outside* flightlog's one job (catch → normalize → append): how to **read**
the log, and how to **ship** it back to yourself.

## `read.js` — a zero-dep reader

flightlog ships no reader on purpose — "the JSONL *is* the interface," and `jq` /
`tail` already read it. But the queries aren't obvious the first time, so `read.js`
carries the operator discipline the way `ship.js` carries the upload one.

- **`readRecords(file, filter)` / `read(file, opts)`** — stream the JSONL
  line-by-line (handles a multi-GB log without loading it into RAM) and filter by
  `kind`, field `match` (e.g. `{ where: 'request' }` or `{ proc: 'cron' }`), and
  `since` an ISO timestamp; `tail: N` keeps the last N via a bounded ring buffer.
- **Skips torn/partial lines** instead of throwing — a reader shouldn't be the bug.
- **Runnable directly**, and it prints the `jq` equivalent under each result so you
  can graduate off it:
  ```
  node examples/read.js errors.jsonl --kind uncaught
  node examples/read.js errors.jsonl --where request --tail 20
  node examples/read.js errors.jsonl --match proc=cron      # multi-process sink
  ```
- **Zero deps.** `node:fs` + `node:readline` + `node:url`.

## `ship.js` — a consent-gated uploader

The layer flightlog deliberately does **not** provide. flightlog records errors
locally and never phones home; if you want logs sent back to you (e.g. a customer
"send diagnostics" opt-in), you build that **on top of the JSONL** — and `ship.js`
is a complete, working starting point.

- **`createShipper({ file, endpoint, consent, … }) → { shipOnce, start, stop }`** —
  reads only the bytes not yet sent (a persisted byte offset in `${file}.shipped`),
  POSTs them as a JSON batch to an endpoint you control, and advances the offset.
- **Consent is the only gate that matters.** `consent()` returns false → nothing is
  read and nothing leaves the disk. Default it OFF.
- **Fails closed on a non-HTTPS endpoint** — a non-`https://` URL returns
  `{ error: 'endpoint must be https' }` and sends nothing; error logs must not cross
  the network in cleartext.
- **Never throws.** A shipper must never become the bug — the same rule as the
  recorder.
- **Zero deps.** Global `fetch` + `node:fs` only.

Two usage shapes (see the wiring block at the bottom of the file):

- **Background trickle** — `ship.start(5 * 60_000)` sends new lines every few
  minutes, only while consent is on.
- **Windows-error-report style** — on a crash prompt, the user clicks "Send" →
  `await ship.shipOnce()`.

> The moment logs land on your server you become the data controller — disclose it.
> When the shipper earns its place (you ship it across more than one app), graduate
> it into its own zero-dep package; never fold transport into flightlog. See the
> threat model and refusals in
> [`flightlog.context.md`](../flightlog.context.md).
