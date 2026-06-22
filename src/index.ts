// Agent<->core dispatch. Contract: `loomis <verb> <run-folder> [args...]`.
// stdout carries EXACTLY ONE JSON envelope; ALL diagnostics go to stderr; exit 0 on ok.

import { realpathSync, readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { argv, exit, stdout } from 'node:process';
import { appendLog } from './log';
import { emptyManifest, readManifest, writeManifest, ManifestError } from './manifest';
import { discoverInputs } from './discovery';
import { syncDesignSystem } from './design-system';
import { writeDesignPreview } from './design-preview';
import { enumerateIntoManifest } from './enumerate';
import { batchGenerate } from './batch';
import { writeNavGraph } from './nav-graph';
import { wireRunFolder } from './wire';
import { assembleBundle } from './assemble';
import { checkRunnable } from './runnable';
import { writeBoard } from './board';
import { regenScreen, variantScreen } from './regen';
import { recordApproval } from './gate';
import { computeCoverage } from './coverage';
import { repairScreens } from './repair';
import { refineScreen, pendingRefinements } from './refine';
import { reconcileSpec } from './reconcile';
import { suggestScreen, promoteSuggestion } from './suggest';
import { addScreen } from './add-screen';
import { startWatch } from './watch';
import { startStudio } from './studio';
import { FakeProvider } from './provider/fake';
import { StitchProvider } from './provider/stitch';
import type { UIProvider } from './provider/uiprovider';
import type { Envelope } from './types';

type Handler = (runFolder: string, args: string[]) => Promise<Envelope> | Envelope;

function pickProvider(args: string[]): UIProvider {
  return args.includes('--fake') ? new FakeProvider() : new StitchProvider();
}

const HANDLERS: Record<string, Handler> = {
  // Initialise a fresh, schema-valid manifest in the run folder (created if missing).
  init: (runFolder) => {
    mkdirSync(runFolder, { recursive: true });
    writeManifest(runFolder, emptyManifest());
    appendLog(runFolder, { event: 'init' });
    return { ok: true, manifest: 'manifest.json', screens: 0 };
  },

  // Validate the existing manifest and report screen count.
  validate: (runFolder) => {
    const manifest = readManifest(runFolder);
    return { ok: true, screens: manifest.screens.length };
  },

  // Discover bmad-ux inputs. Positional run-folder slot is the input dir for this verb.
  discover: (inputDir) => {
    const inputs = discoverInputs(inputDir);
    return {
      ok: true,
      designMd: inputs.designMd,
      experienceMd: inputs.experienceMd,
      stories: inputs.stories,
    };
  },

  // Discover inputs, read DESIGN.md, and instantiate the pinned design system.
  sync: async (runFolder, args) => {
    const inputDir = args[0];
    if (!inputDir) {
      return { ok: false, error: 'usage: sync <run-folder> <input-dir> [--fake]', code: 'USAGE' };
    }
    const inputs = discoverInputs(inputDir);
    const designMd = readFileSync(inputs.designMd, 'utf8');
    const provider = pickProvider(args);
    const manifest = await syncDesignSystem(runFolder, provider, designMd);
    return {
      ok: true,
      projectId: manifest.projectId ?? null,
      assetId: manifest.designSystem?.assetId ?? null,
    };
  },

  // Design-system gate: render the resolved theme for the developer to approve/edit.
  'design-gate': (runFolder, args) => {
    const inputDir = args[0];
    if (!inputDir) {
      return { ok: false, error: 'usage: design-gate <run-folder> <input-dir>', code: 'USAGE' };
    }
    const inputs = discoverInputs(inputDir);
    const designMd = readFileSync(inputs.designMd, 'utf8');
    return { ok: true, ...writeDesignPreview(runFolder, designMd) };
  },

  // Record the developer's approval of the resolved design system (identity is their call).
  'design-approve': (runFolder) => {
    const manifest = readManifest(runFolder);
    if (!manifest.designSystem) {
      return { ok: false, error: 'no design system to approve - run sync first', code: 'NO_DESIGN_SYSTEM' };
    }
    manifest.designSystem.approved = true;
    writeManifest(runFolder, manifest);
    return { ok: true, approved: true };
  },

  // Enumerate target surfaces from EXPERIENCE.md IA and write pending records.
  enumerate: (runFolder, args) => {
    const inputDir = args[0];
    if (!inputDir) {
      return { ok: false, error: 'usage: enumerate <run-folder> <input-dir>', code: 'USAGE' };
    }
    const inputs = discoverInputs(inputDir);
    const experienceMd = readFileSync(inputs.experienceMd, 'utf8');
    const surfaces = enumerateIntoManifest(runFolder, experienceMd);
    return { ok: true, surfaces: surfaces.map((s) => s.screenId) };
  },

  // Derive the page-graph from EXPERIENCE.md IA, resolved against manifest screen ids.
  'nav-graph': (runFolder, args) => {
    const inputDir = args[0];
    if (!inputDir) {
      return { ok: false, error: 'usage: nav-graph <run-folder> <input-dir>', code: 'USAGE' };
    }
    const inputs = discoverInputs(inputDir);
    const experienceMd = readFileSync(inputs.experienceMd, 'utf8');
    const manifest = writeNavGraph(runFolder, experienceMd);
    return {
      ok: true,
      entry: manifest.entry ?? [],
      edges: (manifest.edges ?? []).length,
      unresolved: (manifest.unresolved ?? []).length,
    };
  },

  // Inject relative hrefs into data-nav hooks; dead-stub not-yet-done targets.
  // Reports any IA edge that did not become a live link (no silent connection gaps).
  wire: (runFolder) => {
    const { wired, unwired } = wireRunFolder(runFolder);
    return { ok: true, wired, unwired };
  },

  // Assemble the runnable bundle (out/) + index.html, vendoring assets for offline use.
  assemble: async (runFolder, args) => {
    const r = await assembleBundle(runFolder, { vendor: !args.includes('--no-vendor') });
    return { ok: true, out: r.out, screens: r.screens, assets: r.assets };
  },

  // Write the review board (out/_board/index.html) - a pure projection of the manifest.
  board: (runFolder) => {
    writeBoard(runFolder);
    return { ok: true, screens: readManifest(runFolder).screens.length };
  },

  // Runnability gate: linkinator must find zero broken links in out/.
  check: async (runFolder) => {
    const { passed, broken } = await checkRunnable(join(runFolder, 'out'));
    if (passed) return { ok: true, passed, broken };
    return { ok: false, error: `broken links: ${broken.length}`, code: 'BROKEN_LINKS' };
  },

  // Interactive studio: a browser control surface that DRIVES the weave end-to-end -
  // plan → confirm theme → stream generation → refine/explore/promote → assemble.
  studio: async (runFolder, args) => {
    const rest = args.filter((a) => !a.startsWith('--'));
    const inputDir = rest[0];
    if (!inputDir) {
      return { ok: false, error: 'usage: studio <run-folder> <input-dir> [--fake] [--no-open] [--keep=SECONDS] [--brain=agent]', code: 'USAGE' };
    }
    const keepArg = args.find((a) => a.startsWith('--keep='));
    const keepAliveSeconds = keepArg ? Number(keepArg.split('=')[1]) : undefined;
    const brain = args.find((a) => a.startsWith('--brain='))?.split('=')[1] === 'agent' ? 'agent' : undefined;
    const { url } = await startStudio(runFolder, inputDir, pickProvider(args), {
      noOpen: args.includes('--no-open'),
      ...(keepAliveSeconds && Number.isFinite(keepAliveSeconds) ? { keepAliveSeconds } : {}),
      ...(brain ? { brain } : {}),
    });
    return { ok: true, studio: true, url };
  },

  // Live progress board: open a browser tab that polls this run's manifest + log, and
  // serve until the weave completes (run this alongside generate-all in another terminal).
  watch: async (runFolder, args) => {
    const timeoutArg = args.find((a) => a.startsWith('--timeout='));
    const timeoutSeconds = timeoutArg ? Number(timeoutArg.split('=')[1]) : undefined;
    const { url } = await startWatch(runFolder, {
      noOpen: args.includes('--no-open'),
      ...(timeoutSeconds && Number.isFinite(timeoutSeconds) ? { timeoutSeconds } : {}),
    });
    return { ok: true, watched: true, url };
  },

  // Force-regenerate one screen (past the hash-skip), non-destructively.
  regen: async (runFolder, args) => {
    const inputDir = args[0];
    const screenId = args[1];
    if (!inputDir || !screenId) {
      return { ok: false, error: 'usage: regen <run-folder> <input-dir> <screen-id> [--fake]', code: 'USAGE' };
    }
    const inputs = discoverInputs(inputDir);
    const experienceMd = readFileSync(inputs.experienceMd, 'utf8');
    const rec = await regenScreen(runFolder, pickProvider(args), experienceMd, screenId);
    return { ok: true, screenId, status: rec.status, regenCount: rec.regenCount ?? 0 };
  },

  // Directed refine: apply free-text feedback to one screen (not a blind re-roll) and
  // record it as provenance. Re-run wire + assemble afterwards to update out/.
  refine: async (runFolder, args) => {
    const rest = args.filter((a) => !a.startsWith('--'));
    const screenId = rest[0];
    const feedback = rest.slice(1).join(' ');
    if (!screenId || !feedback) {
      return { ok: false, error: 'usage: refine <run-folder> <screen-id> "<feedback>" [--fake]', code: 'USAGE' };
    }
    const rec = await refineScreen(runFolder, pickProvider(args), screenId, feedback);
    return { ok: true, screenId, refinements: rec.refinements ?? [], status: rec.status };
  },

  // The hybrid nudge: list screens whose live edits are not yet folded into the spec.
  refinements: (runFolder) => {
    const pending = pendingRefinements(runFolder);
    return {
      ok: true,
      pending,
      note: pending.length
        ? 'These live edits are NOT in your spec yet - fold lasting ones into EXPERIENCE.md/DESIGN.md so a re-weave reproduces them.'
        : 'No pending refinements.',
    };
  },

  // Fold recorded refinements back into EXPERIENCE.md (and clear them from the manifest),
  // so the spec is the single source of truth and a clean re-weave reproduces the edits.
  reconcile: (runFolder, args) => {
    const rest = args.filter((a) => !a.startsWith('--'));
    const inputDir = rest[0];
    const screenId = rest[1];
    if (!inputDir) {
      return { ok: false, error: 'usage: reconcile <run-folder> <input-dir> [screen-id]', code: 'USAGE' };
    }
    const inputs = discoverInputs(inputDir);
    const { folded } = reconcileSpec(runFolder, inputs.experienceMd, screenId);
    return { ok: true, folded };
  },

  // Generate N alternative designs for one screen (non-destructive candidates to pick from).
  suggest: async (runFolder, args) => {
    const rest = args.filter((a) => !a.startsWith('--'));
    const inputDir = rest[0];
    const screenId = rest[1];
    if (!inputDir || !screenId) {
      return { ok: false, error: 'usage: suggest <run-folder> <input-dir> <screen-id> [--count=N] [--fake]', code: 'USAGE' };
    }
    const countArg = args.find((a) => a.startsWith('--count='));
    const count = countArg ? Number(countArg.split('=')[1]) : undefined;
    const inputs = discoverInputs(inputDir);
    const experienceMd = readFileSync(inputs.experienceMd, 'utf8');
    const options = await suggestScreen(
      runFolder,
      pickProvider(args),
      experienceMd,
      screenId,
      count && Number.isFinite(count) ? { count } : {},
    );
    return { ok: true, screenId, options };
  },

  // Add a NEW screen derived from an existing one + a modifier (additive, non-destructive).
  add: async (runFolder, args) => {
    const rest = args.filter((a) => !a.startsWith('--'));
    const inputDir = rest[0];
    const baseScreenId = rest[1];
    const instruction = rest.slice(2).join(' ');
    if (!inputDir || !baseScreenId || !instruction) {
      return { ok: false, error: 'usage: add <run-folder> <input-dir> <base-screen-id> "<instruction>" [--fake]', code: 'USAGE' };
    }
    const inputs = discoverInputs(inputDir);
    const experienceMd = readFileSync(inputs.experienceMd, 'utf8');
    const r = await addScreen(runFolder, pickProvider(args), experienceMd, baseScreenId, instruction);
    return { ok: true, screenId: r.screenId, surface: r.surface };
  },

  // Promote a chosen suggestion to the live screen, preserving the prior take.
  promote: async (runFolder, args) => {
    const rest = args.filter((a) => !a.startsWith('--'));
    const screenId = rest[0];
    const option = Number(rest[1]);
    if (!screenId || !Number.isFinite(option)) {
      return { ok: false, error: 'usage: promote <run-folder> <screen-id> <option-number>', code: 'USAGE' };
    }
    const rec = await promoteSuggestion(runFolder, screenId, option);
    return { ok: true, screenId, promoted: option, providerScreen: rec.providerScreen ?? null };
  },

  // Take a new variant of one screen, preserving the prior take's bytes.
  variant: async (runFolder, args) => {
    const inputDir = args[0];
    const screenId = args[1];
    if (!inputDir || !screenId) {
      return { ok: false, error: 'usage: variant <run-folder> <input-dir> <screen-id> [--fake]', code: 'USAGE' };
    }
    const inputs = discoverInputs(inputDir);
    const experienceMd = readFileSync(inputs.experienceMd, 'utf8');
    const rec = await variantScreen(runFolder, pickProvider(args), experienceMd, screenId);
    return { ok: true, screenId, status: rec.status, regenCount: rec.regenCount ?? 0 };
  },

  // Record a review verdict (reject/approve) on one screen.
  reject: (runFolder, args) => {
    const screenId = args[0];
    if (!screenId) return { ok: false, error: 'usage: reject <run-folder> <screen-id> [reason]', code: 'USAGE' };
    recordApproval(runFolder, screenId, 'rejected', args[1]);
    return { ok: true, screenId, verdict: 'rejected' };
  },

  // Coverage report: every targeted surface/story -> screen, with gaps + orphans.
  coverage: (runFolder) => {
    const manifest = readManifest(runFolder);
    const knownStoryIds = [
      ...new Set(manifest.screens.map((s) => s.story).filter((x): x is string => !!x)),
    ];
    const report = computeCoverage(manifest, knownStoryIds);
    return {
      ok: true,
      covered: Object.keys(report.stories).length,
      uncovered: report.uncovered,
      orphans: report.orphans,
    };
  },

  // Repair: regenerate (once) any screen that came back missing requested content.
  repair: async (runFolder, args) => {
    const inputDir = args[0];
    if (!inputDir) {
      return { ok: false, error: 'usage: repair <run-folder> <input-dir> [--fake]', code: 'USAGE' };
    }
    const inputs = discoverInputs(inputDir);
    const experienceMd = readFileSync(inputs.experienceMd, 'utf8');
    const { repaired } = await repairScreens(runFolder, pickProvider(args), experienceMd);
    return { ok: true, repaired };
  },

  // Serially generate every enumerated surface (concurrency = 1).
  'generate-all': async (runFolder, args) => {
    const inputDir = args[0];
    if (!inputDir) {
      return { ok: false, error: 'usage: generate-all <run-folder> <input-dir> [--fake]', code: 'USAGE' };
    }
    const inputs = discoverInputs(inputDir);
    const experienceMd = readFileSync(inputs.experienceMd, 'utf8');
    const provider = pickProvider(args);
    const results = await batchGenerate(runFolder, provider, experienceMd);
    return {
      ok: true,
      total: results.length,
      done: results.filter((r) => r.status === 'done').length,
      failed: results.filter((r) => r.status === 'failed').length,
    };
  },
};

export async function dispatch(
  verb: string,
  runFolder: string,
  args: string[] = [],
): Promise<Envelope> {
  const handler = HANDLERS[verb];
  if (!handler) {
    return { ok: false, error: `unknown verb: ${verb}`, code: 'UNKNOWN_VERB' };
  }
  try {
    return await handler(runFolder, args);
  } catch (e) {
    let code = 'HANDLER_ERROR';
    if (e instanceof ManifestError) {
      code = e.code;
    } else if (e && typeof e === 'object' && 'code' in e && typeof (e as { code?: unknown }).code === 'string') {
      code = (e as { code: string }).code;
    }
    const error = e instanceof Error ? e.message : String(e);
    return { ok: false, error, code };
  }
}

export async function main(args: string[]): Promise<number> {
  const [verb, runFolder, ...rest] = args;
  let envelope: Envelope;
  if (!verb || !runFolder) {
    envelope = {
      ok: false,
      error: 'usage: loomis <verb> <run-folder> [args...]',
      code: 'USAGE',
    };
  } else {
    envelope = await dispatch(verb, runFolder, rest);
  }
  stdout.write(JSON.stringify(envelope) + '\n');
  return envelope.ok ? 0 : 1;
}

function isMainModule(): boolean {
  if (!argv[1]) return false;
  try {
    return realpathSync(argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMainModule()) {
  void main(argv.slice(2)).then((code) => exit(code));
}
