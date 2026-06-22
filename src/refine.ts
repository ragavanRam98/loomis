// Directed refine (the "change THIS, like this" loop). Unlike `regen`/`variant` - which
// blind-re-roll the SAME spec - `refine` applies free-text feedback to an existing screen
// via the provider's directed edit, then RECORDS the feedback on the screen record so the
// change is reproducible and auditable. The prior take's bytes are preserved (Stitch has no
// delete). Hybrid trail: the recorded refinements are what `refinements` later nudges you to
// fold back into EXPERIENCE.md/DESIGN.md so a clean re-weave reproduces the look.

import { copyFileSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readManifest, writeManifest } from './manifest';
import { appendLog, progress } from './log';
import type { Clock } from './log';
import type { UIProvider, GenerateOptions } from './provider/uiprovider';
import type { ScreenRecord } from './types';

export class RefineError extends Error {
  readonly code: string;
  constructor(message: string, code = 'REFINE_ERROR') {
    super(message);
    this.name = 'RefineError';
    this.code = code;
  }
}

export async function refineScreen(
  runFolder: string,
  provider: UIProvider,
  screenId: string,
  feedback: string,
  clock?: Clock,
): Promise<ScreenRecord> {
  const trimmed = feedback.trim();
  if (!trimmed) throw new RefineError('empty feedback - nothing to apply', 'EMPTY_FEEDBACK');

  const manifest = readManifest(runFolder);
  const projectId = manifest.projectId;
  if (!projectId) throw new RefineError('no projectId in manifest - sync first', 'NO_PROJECT');

  const rec = manifest.screens.find((s) => s.screenId === screenId);
  if (!rec) throw new RefineError(`unknown screen: ${screenId}`, 'UNKNOWN_SCREEN');
  if (!rec.providerScreen) {
    throw new RefineError(`screen ${screenId} has no generated screen to edit - generate it first`, 'NOT_GENERATED');
  }

  // Preserve the current take before editing (non-destructive - Stitch has no delete).
  const version = (rec.refinements?.length ?? 0) + 1;
  if (rec.htmlPath) {
    const src = join(runFolder, rec.htmlPath);
    if (existsSync(src)) copyFileSync(src, join(runFolder, `${screenId}.pre-refine${version}.html`));
  }

  progress(`Refining ${screenId}: "${trimmed}"…`);
  const device = manifest.designSystem?.device as GenerateOptions['device'] | undefined;
  const edited = await provider.editScreen(projectId, rec.providerScreen, trimmed, device ? { device } : {});

  // Persist the edited bytes over the live screen.
  const htmlPath = `${screenId}.html`;
  writeFileSync(join(runFolder, htmlPath), edited.html, 'utf8');
  rec.htmlPath = htmlPath;
  rec.providerScreen = edited.screenId;
  rec.status = 'done';
  if (edited.screenshot) {
    const shotPath = `${screenId}.png`;
    writeFileSync(join(runFolder, shotPath), edited.screenshot);
    rec.screenshotPath = shotPath;
  }

  // Record the feedback as provenance (the hybrid trail).
  rec.refinements = [...(rec.refinements ?? []), trimmed];
  writeManifest(runFolder, manifest);
  appendLog(runFolder, { event: 'refine', screenId, detail: { feedback: trimmed, count: rec.refinements.length } }, clock);

  progress(
    `Refined ${screenId} (${rec.refinements.length} edit${rec.refinements.length > 1 ? 's' : ''}). ` +
      `Re-run wire + assemble to update out/. When this look is final, fold it into EXPERIENCE.md so a re-weave reproduces it.`,
  );
  return rec;
}

export interface PendingRefinement {
  screenId: string;
  surface?: string;
  story?: string;
  refinements: string[];
}

/** The hybrid nudge: screens whose live edits are NOT yet reflected in the spec. */
export function pendingRefinements(runFolder: string): PendingRefinement[] {
  const manifest = readManifest(runFolder);
  return manifest.screens
    .filter((s) => s.refinements && s.refinements.length > 0)
    .map((s) => ({
      screenId: s.screenId,
      ...(s.surface ? { surface: s.surface } : {}),
      ...(s.story ? { story: s.story } : {}),
      refinements: s.refinements ?? [],
    }));
}
