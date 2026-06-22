# Contributing to Loomis

Thanks for your interest! Loomis is a `0.2.0` public preview - issues, ideas, and PRs are welcome.

## Dev setup

Requires **Node ≥ 22**.

```bash
npm install
npm run build        # tsup → dist/index.js
npm test             # vitest - should be 142 green
npx tsc --noEmit     # typecheck (tsup does NOT typecheck)
```

## The studio browser-JS check (important)

The studio UI is a large template-literal string of HTML+JS in `src/studio.ts`. **Neither tsup nor `tsc` can see inside that string**, so a syntax error in the browser JS will build clean and only fail at runtime. Before committing studio changes, verify the served script parses:

1. Serve the studio against the fake provider: `node dist/index.js studio /tmp/x ./examples/vital --fake --no-open` (it prints a local URL).
2. Fetch the page, extract each `<script>…</script>` block, and run `node --check` on it.

There's an example of this extraction in the project history; the rule is simply: **studio JS must `node --check` clean.**

## Conventions

- **TypeScript ESM**, Node ≥ 22 target.
- The agent↔core contract is sacred: each CLI verb prints **exactly one JSON envelope on stdout**; **all** diagnostics go to **stderr**.
- The provider is reached only through the port in `src/provider/uiprovider.ts`. New providers are new adapters - don't call a provider SDK directly from the engine.
- Generation must stay **idempotent** (skip unchanged-and-done) and **non-destructive** (preserve prior takes when changing a screen).
- `STITCH_API_KEY` is read in exactly one place (the Stitch adapter) and must never be logged or written to artifacts.
- Add a sibling `*.test.ts` for new modules; keep the suite green.

## Architecture

See [`docs/architecture.md`](./docs/architecture.md) for the pipeline, contracts, and module map.

## Security

Never commit a real `STITCH_API_KEY` (or any run folder / `.studio.lock`). Report security issues privately rather than in a public issue.
