# Loomis - Architecture

A concise map of how Loomis is built. The exhaustive planning record lives in the project's
BMAD planning artifacts; this is the self-contained version for the repo.

## Shape

Loomis is three layers:

1. **BMAD agent layer** - `bmad-agent-ui-weaver/` (the Loomis persona) + `bmad-weave-ui/` (the workflow). It orchestrates, runs the human gates, and surfaces results. It is *AI-tool-agnostic* - it only shells out to the core.
2. **Deterministic core** - `src/`, built to `dist/index.js`. Small, must-be-correct TypeScript modules invoked as `node dist/index.js <verb> <run-folder> [args]`.
3. **Interactive studio** - `src/studio.ts`, a local HTTP server + browser control surface that *drives* the core in-process and adds a pluggable **brain** (`src/brain.ts`).

## Contracts (the load-bearing invariants)

- **One JSON envelope on stdout.** Every verb prints exactly one `{ok:true,…}` or `{ok:false,error,code}` to stdout; **all** logging goes to stderr. Callers parse the envelope, never stderr. (`src/index.ts`, `src/log.ts`)
- **The manifest is the sole interface.** `manifest.json` in the run folder is the flat receipt the agent and core share - project id, design system, and per-screen records (status, paths, provider handle, input hash, refinements, suggestions). (`src/manifest.ts`, `src/types.ts`, schema in `schema/`)
- **Provider behind a port.** All provider calls go through `src/provider/uiprovider.ts`. `stitch.ts` is the real adapter (key from env, no destructive ops); `fake.ts` is the deterministic in-memory adapter that backs tests and `--fake`.
- **DESIGN.md / EXPERIENCE.md are the source of truth.** The core never invents UI intent; identity (color/type/tone) is the one decision left to the human, at the design gate.
- **Offline guarantee.** `assemble` vendors every asset locally so `out/` runs with the network off.
- **Idempotent + non-destructive.** Unchanged-and-done screens are skipped (input-hash); every change (refine / promote / add) preserves the prior take.
- **Runnable for any subset.** `wire` dead-stubs not-yet-built targets so a half-finished run still serves; `check` (linkinator) must find zero broken links.

## The pipeline

```
discover ─▶ sync (design system) ─▶ enumerate ─▶ generate-all ─▶ nav-graph ─▶ wire ─▶ assemble ─▶ check
              │  (design gate)          │            (screen-1 gate)                    │ (vendor offline)
              ▼                         ▼                                               ▼
        design-preview            manifest records                                 out/ + index + board
```

## Module map (`src/`)

| Area | Modules |
|------|---------|
| Dispatch + contract | `index.ts`, `types.ts`, `manifest.ts`, `log.ts`, `slug.ts`, `hash.ts` |
| Inputs | `discovery.ts`, `experience.ts`, `design-system.ts`, `design-preview.ts` |
| Generation | `enumerate.ts`, `compile.ts`, `prompt.ts`, `generate.ts`, `batch.ts`, `poll.ts`, `reconcile.ts` |
| Connect + assemble | `nav-graph.ts`, `wire.ts`, `assemble.ts`, `runnable.ts`, `board.ts` |
| Change loop | `regen.ts`, `repair.ts`, `refine.ts`, `suggest.ts`, `add-screen.ts`, `coverage.ts`, `gate.ts`, `provenance.ts` |
| Interactive | `studio.ts`, `brain.ts`, `watch.ts` |
| Provider | `provider/uiprovider.ts`, `provider/stitch.ts`, `provider/fake.ts`, `provider/transport.ts` |

## The studio + brain seam

`studio.ts` runs a `StudioSession` state machine (plan → design → generate → review → assembling → done) that calls the same core functions, narrates phases, and serves a single-page control surface. Developer intents from the command bar are sent to a `StudioBrain`:

- `MechanicalBrain` - a transparent heuristic that classifies intent into `refine` / `suggest` (variants) / `add`, and never silently replaces on a create request.
- `BridgeBrain` (`--brain=agent`) - writes the intent to a file bus and waits for an external agent to answer, falling back to the heuristic on timeout. This is the seam that lets a live agent *be* the brain behind the portal.

A studio resumes an existing project (idempotent design-system reuse → done screens skip → straight to review) and holds it with a `.studio.lock` so only one studio runs per project.

## Build + test

`tsup` bundles `src/index.ts` → `dist/index.js` (ESM, Node 22, shebang injected, deps external). `vitest` covers every module with sibling `*.test.ts` files. Because the studio's browser JS lives inside a template literal, it is verified separately with `node --check` on the served `<script>` (see CONTRIBUTING).
