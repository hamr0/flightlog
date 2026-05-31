# CLAUDE.md — agent context for flightlog

Repo-only (not shipped to npm). Adopters read `README.md` + `flightlog.context.md`;
this file is for whoever (human or agent) *builds* flightlog.

## Constant references — read these first, every time

- **[`.claude/memory/AGENT_RULES.md`](.claude/memory/AGENT_RULES.md)** — the parent
  standard. POC-first, dependency hierarchy (vanilla → stdlib → external),
  simple-over-clever, open-source-only, security invariants, Testing Trophy,
  **build incrementally in small independent modules**. **When anything conflicts,
  AGENT_RULES wins.**
- **[`.claude/memory/LIBRARY_CONVENTIONS.md`](.claude/memory/LIBRARY_CONVENTIONS.md)**
  — how a publishable JS lib is shaped here: pure ESM + JSDoc → generated `.d.ts`
  (no drift), the adopter `context.md`, the doc set, CI/publish shape.

These two are the standing rulebook for this repo. Do not restate them here — defer
to them.

## Where the rationale lives

- **[`docs/01-product/2026-05-31-prd.md`](docs/01-product/2026-05-31-prd.md)** — the
  PRD: locked decisions + *why*, success criteria, Go/No-Go gate. The durable
  reasoning that doesn't belong in the adopter-facing docs lives here.

## Doctrine (one line each)

- **Zero production dependencies.** Vanilla + `node:fs` only. A second prod dep
  re-opens the PRD.
- **Errors only.** Not a general logger (no info/warn levels).
- **The JSONL is the interface.** No UI, no server, no reader ships.
- **Default-out on context.** flightlog never harvests; it logs only what the
  adopter passes. Mechanism in the lib, policy in the adopter.
- **Never becomes the bug.** A write failure is swallowed (app never crashes) but
  surfaced once to stderr. The *one* exception is the boot-time writability check,
  which is fatal by default (fail loud at deploy) — but as of 0.3.0 `bootCheck:false`
  makes even that non-fatal for short-lived/per-invocation processes (PRD §14.1).

## Most-litigated refusals (don't re-add these without re-opening the PRD)

- No aggregation / dedup / counts — scale-gated; `jq` covers it.
- No breadcrumbs / auto-captured context — the surveillance payload we refuse.
- No symbolication / alerting / release tracking — team/scale process.
- No restart logic — that's the supervisor's (systemd/Docker/pm2) job.
- **Unhandled rejections log only and do NOT exit *by default*** — note this
  *suppresses Node's own default crash-on-rejection*. Intended: a stray rejection
  shouldn't take a server down. As of 0.2.0 there is an **opt-in `exitOnRejection`**
  (default `false`, so the doctrine default is unchanged) for short-lived processes
  that must die non-zero — see PRD §14 for why this opt-in did *not* violate the
  refusal. Document as a gotcha in `context.md`.

## Build approach

Modular/incremental per AGENT_RULES — each module works on its own before the next:
1. `normalize()` (pure) → 2. `sink` (append + rotation + self-failure + boot check)
→ 3. `install()` (wires global handlers + `capture` onto 1 + 2).

## Not shipped

`CLAUDE.md`, `docs/`, `poc/`, `.github/`, `.claude/` are repo-only — excluded from
the `package.json` `files` allowlist.
