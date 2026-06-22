# bmad-weave-ui

Weave a runnable, connected, fully-local UI from the bmad-ux outputs. This is the **agent layer** over the Loomis deterministic core (`loomis/dist/index.js`); it orchestrates, runs the human approval gates, and surfaces results. Every core call returns **one JSON envelope on stdout** (logs → stderr); parse the envelope, never stderr.

## Inputs

- `INPUT_DIR` - the `bmad-ux` output folder containing `DESIGN.md`, `EXPERIENCE.md`, and stories.
- `RUN_FOLDER` - the output workspace, e.g. `{planning_artifacts}/ui/loomis-{project}-{date}/`.

## Steps

1. **Discover** - `node loomis/dist/index.js discover {INPUT_DIR}`. Confirm DESIGN.md / EXPERIENCE.md / stories were found; halt with the envelope's `error` if not.
2. **Init + Sync** - `node loomis/dist/index.js init {RUN_FOLDER}` then `node loomis/dist/index.js sync {RUN_FOLDER} {INPUT_DIR}`. This creates/reuses the provider project and instantiates the **pinned design system** from `DESIGN.md` (`DESIGN.md` stays the source of truth).
3. **Design-system gate (BLOCKING - human-gated on identity)** - `node loomis/dist/index.js design-gate {RUN_FOLDER} {INPUT_DIR}`. Open `out/_design/index.html` and show the developer the **resolved theme** - colour swatches, fonts, tone, and any provider token remaps. Ask them to **approve** or **edit DESIGN.md and re-sync**. Only on approval (`design-approve {RUN_FOLDER}`) proceed. Identity (colour/type/tone) is the one decision that stays the human's; everything below is autonomous.
4. **Screen-1 gate (BLOCKING)** - generate the first surface, show the developer the rendered screen + its story + the omissions, and ask **approve / regenerate**. Surface the pre-run estimate (N screens → ~N generations) before committing. *(Implemented: Epic 1.)*
5. **Launch the live progress board, then batch-generate.** Before the long unattended run, start the board **in the background** (the harness's background-run, or a trailing `&`): `node loomis/dist/index.js watch {RUN_FOLDER}`. It opens a browser tab that polls the run's `manifest.json` + `.loomis-run.log` and streams every surface `pending → in-flight → done/failed`, then **self-closes when the bundle is assembled** (or after a 30-min ceiling; `--timeout=N` to change it). Pass `--no-open` for headless/CI (it just prints the local URL). Then **batch-generate** the remaining surfaces enumerated from `EXPERIENCE.md` IA + stories - the board reflects each screen live, so the developer is never staring at a black box during the ~1 min/screen MCP calls. *(Epic 2.)*
6. **Wire + assemble + board** - derive the page-graph, inject `data-nav` links, vendor assets offline, assemble the runnable bundle, and write the `review.html` board. *(Epic 2.)*
7. **Review + change** - let the developer review the whole site and change any screen, non-destructively:
   - `regen` / `variant` - re-roll a screen from the SAME spec (a different take; your words don't steer it).
   - `refine {RUN_FOLDER} {screen} "{feedback}"` - **directed edit**: apply the developer's exact feedback ("lighter theme, smaller header, move nav to top") to that screen, and record it as provenance. After a refine, re-run `wire` + `assemble` to update `out/`.
   - `suggest {RUN_FOLDER} {INPUT_DIR} {screen} [--count=N]` - **multiple options**: generate N on-theme alternative designs as non-destructive candidates. Show them, then `promote {RUN_FOLDER} {screen} {option}` to make the developer's pick the live screen (the prior take is preserved). Re-run `wire` + `assemble` after promoting.
   - `add {RUN_FOLDER} {INPUT_DIR} {screen} "{instruction}"` - **add a NEW screen** derived from an existing one (e.g. a light-mode variant of a surface): additive, never a replace. The new surface joins the prototype index automatically; re-run `wire` + `assemble`.
   - `refinements {RUN_FOLDER}` - the **hybrid nudge**: lists screens whose live edits aren't in the spec yet. Then `reconcile {RUN_FOLDER} {INPUT_DIR} [screen]` **folds** those refinements back into `EXPERIENCE.md` under each surface and clears them from the manifest - so the spec is the single source of truth and a clean re-weave reproduces the look (every screen stays traceable). *(Epic 3.)*

> Add `--fake` to step 2's `sync` (and later generate verbs) to drive the flow against the in-memory provider with no network - useful for dry runs and tests.

## The studio (interactive alternative)

Steps 3–7 are the **headless** flow (gates → watch → batch → review), ideal for CI or scripted runs. The same weave is also one **interactive** command:

`node loomis/dist/index.js studio {RUN_FOLDER} {INPUT_DIR} [--fake] [--no-open] [--keep=SECONDS] [--brain=agent]`

It opens a local browser control surface that drives the weave end-to-end and pauses at the same human decisions (confirm theme; review + change each screen), adding:

- **Resume** - relaunch on an existing run folder and it reopens the woven screens instantly (idempotent design-system reuse - no re-weave). One studio per project (a `.studio.lock` prevents rival sessions).
- **A command bar with transparent intent routing** - natural language is classified into `refine` (edit in place), `suggest`/variants (options to pick from), or `add` (a new screen), and it **never silently replaces on a create request**; the chosen action + reasoning are shown on the card.
- **In-flight feedback, crisp live previews, and an OS-following light/dark theme.**

Use `--brain=agent` to route the command-bar intents through an external agent (the file-bus `BridgeBrain`) instead of the built-in heuristic - this is how "the agent is the brain behind the portal."

## description

Weave the UI: generate screens from bmad-ux docs and wire them into a runnable local site. Use when the user says "weave the UI" or runs Loomis.
