# flightlog

> A flight recorder for your app — zero-dependency local error capture to JSONL.

**Status: early WIP (`0.0.1` placeholder).** The API below is the planned `0.1.0`
shape, not yet implemented. This release reserves the name; do not depend on it yet.

## What it will be

A ~50-line, zero-dependency Node library that catches the errors your app would
otherwise lose — uncaught exceptions, unhandled promise rejections, and errors you
hand it — and appends each as one JSON line to a local JSONL file you can read at
any time, even on a healthy app, to see *where things have failed*.

```js
import { install } from 'flightlog';

const { capture } = install({
  file: '/var/log/myapp/errors.jsonl',       // sink; omit → stderr
  context: { app: 'myapp', release: 'v1.0' }, // static, you choose — never auto-harvested
});

try { risky(); } catch (err) { capture(err, { where: 'checkout' }); }
```

## What it is *not*

No aggregation, no dedup, no breadcrumbs, no UI, no server, no phone-home, no
auto-captured context. The JSONL is the interface — read it with `tail`/`jq`/your
editor. It's the local, private alternative to a hosted error-monitoring SaaS for
solo, pre-scale, zero-telemetry apps.

## License

Apache-2.0 © 2026 Amr
