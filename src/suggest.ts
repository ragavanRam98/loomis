// Multiple UI suggestions (the "pick your favorite" loop). `suggest` asks the provider for N
// alternative designs of a screen and stores them as candidate options (non-destructively - the
// live screen is untouched). `promote` makes a chosen option the live screen, preserving the
// prior take. This is the directed counterpart to `variant`'s blind one-at-a-time re-roll.

import { writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { readManifest, writeManifest } from './manifest';
import { compileScreen } from './compile';
import { appendLog, progress } from './log';
import type { Clock } from './log';
import type { UIProvider, GenerateOptions, VariantGenOptions } from './provider/uiprovider';
import type { ScreenRecord, SuggestionRef } from './types';

export class SuggestError extends Error {
  readonly code: string;
  constructor(message: string, code = 'SUGGEST_ERROR') {
    super(message);
    this.name = 'SuggestError';
    this.code = code;
  }
}

export async function suggestScreen(
  runFolder: string,
  provider: UIProvider,
  experienceMd: string,
  screenId: string,
  opts: { count?: number } = {},
  clock?: Clock,
): Promise<SuggestionRef[]> {
  const manifest = readManifest(runFolder);
  const projectId = manifest.projectId;
  if (!projectId) throw new SuggestError('no projectId in manifest - sync first', 'NO_PROJECT');

  const rec = manifest.screens.find((s) => s.screenId === screenId);
  if (!rec) throw new SuggestError(`unknown screen: ${screenId}`, 'UNKNOWN_SCREEN');
  if (!rec.providerScreen) {
    throw new SuggestError(`screen ${screenId} has no generated screen to vary - generate it first`, 'NOT_GENERATED');
  }
  if (!rec.surface) throw new SuggestError(`screen ${screenId} has no surface to compile from`, 'NO_SURFACE');

  // Keep options on-spec: vary against the surface's own compiled prompt, design system pinned.
  const compiled = compileScreen(experienceMd, rec.surface, manifest.designSystem?.assetId);
  const device = manifest.designSystem?.device as GenerateOptions['device'] | undefined;
  const genOpts: VariantGenOptions = { count: opts.count ?? 3, creativeRange: 'explore' };
  if (device) genOpts.device = device;

  progress(`Generating ${genOpts.count} design option(s) for ${screenId}…`);
  const options = await provider.generateVariants(projectId, rec.providerScreen, compiled.prompt, genOpts);

  const suggestions: SuggestionRef[] = options.map((o, i) => {
    const n = i + 1;
    const htmlPath = `${screenId}.option-${n}.html`;
    writeFileSync(join(runFolder, htmlPath), o.html, 'utf8');
    const ref: SuggestionRef = { option: n, providerScreen: o.screenId, htmlPath };
    if (o.screenshot) {
      const shotPath = `${screenId}.option-${n}.png`;
      writeFileSync(join(runFolder, shotPath), o.screenshot);
      ref.screenshotPath = shotPath;
    }
    return ref;
  });

  rec.suggestions = suggestions;
  writeManifest(runFolder, manifest);
  appendLog(runFolder, { event: 'suggest', screenId, detail: { count: suggestions.length } }, clock);
  progress(`${suggestions.length} option(s) ready for ${screenId} - review, then \`promote\` one.`);
  return suggestions;
}

export async function promoteSuggestion(
  runFolder: string,
  screenId: string,
  option: number,
  clock?: Clock,
): Promise<ScreenRecord> {
  const manifest = readManifest(runFolder);
  const rec = manifest.screens.find((s) => s.screenId === screenId);
  if (!rec) throw new SuggestError(`unknown screen: ${screenId}`, 'UNKNOWN_SCREEN');
  const sug = rec.suggestions?.find((s) => s.option === option);
  if (!sug) throw new SuggestError(`no option ${option} for ${screenId} - run \`suggest\` first`, 'UNKNOWN_OPTION');

  // Preserve the current live take before promoting (non-destructive).
  if (rec.htmlPath) {
    const cur = join(runFolder, rec.htmlPath);
    if (existsSync(cur)) copyFileSync(cur, join(runFolder, `${screenId}.pre-promote.html`));
  }

  copyFileSync(join(runFolder, sug.htmlPath), join(runFolder, `${screenId}.html`));
  rec.htmlPath = `${screenId}.html`;
  rec.providerScreen = sug.providerScreen;
  rec.status = 'done';
  if (sug.screenshotPath && existsSync(join(runFolder, sug.screenshotPath))) {
    copyFileSync(join(runFolder, sug.screenshotPath), join(runFolder, `${screenId}.png`));
    rec.screenshotPath = `${screenId}.png`;
  }

  writeManifest(runFolder, manifest);
  appendLog(runFolder, { event: 'promote', screenId, detail: { option } }, clock);
  progress(`Promoted option ${option} to ${screenId}. Re-run wire + assemble to update out/.`);
  return rec;
}
