// Non-destructive regenerate / variant (FR-12, FR-13, FR-17). `regen` forces a single screen
// past the idempotency skip and bumps regenCount; `variant` first preserves the prior take's
// bytes to a versioned file (never deleting - Stitch has no delete) then regenerates.

import { copyFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { readManifest, writeManifest } from './manifest';
import { generateOneScreen } from './generate';
import { compileScreen, type CompiledScreen } from './compile';
import { enumerateSurfaces } from './enumerate';
import { appendLog } from './log';
import type { Clock } from './log';
import type { UIProvider } from './provider/uiprovider';
import type { ScreenRecord } from './types';

export class RegenError extends Error {
  readonly code: string;
  constructor(message: string, code = 'REGEN_ERROR') {
    super(message);
    this.name = 'RegenError';
    this.code = code;
  }
}

function compiledForScreen(
  experienceMd: string,
  screenId: string,
  designSystemId?: string,
): CompiledScreen | undefined {
  const s = enumerateSurfaces(experienceMd).find((x) => x.screenId === screenId);
  if (!s) return undefined;
  return compileScreen(experienceMd, s.surface, designSystemId);
}

export async function regenScreen(
  runFolder: string,
  provider: UIProvider,
  experienceMd: string,
  screenId: string,
  clock?: Clock,
): Promise<ScreenRecord> {
  const manifest = readManifest(runFolder);
  if (!manifest.screens.find((s) => s.screenId === screenId)) {
    throw new RegenError(`unknown screen: ${screenId}`, 'UNKNOWN_SCREEN');
  }
  const c = compiledForScreen(experienceMd, screenId, manifest.designSystem?.assetId);
  if (!c) throw new RegenError(`screen not in EXPERIENCE.md: ${screenId}`, 'UNKNOWN_SCREEN');

  // Force past the hash-skip; only this screen's record/files change (graph untouched).
  await generateOneScreen(
    runFolder,
    provider,
    {
      screenId,
      surface: c.surface,
      prompt: c.prompt,
      expectedContent: c.expectedContent,
      ...(c.story ? { story: c.story } : {}),
    },
    { clock, skipIfUnchanged: false },
  );

  const m2 = readManifest(runFolder);
  const rec = m2.screens.find((s) => s.screenId === screenId);
  if (!rec) throw new RegenError(`screen vanished: ${screenId}`, 'UNKNOWN_SCREEN');
  rec.regenCount = (rec.regenCount ?? 0) + 1;
  writeManifest(runFolder, m2);
  appendLog(runFolder, { event: 'regen', screenId, detail: { regenCount: rec.regenCount } }, clock);
  return rec;
}

export async function variantScreen(
  runFolder: string,
  provider: UIProvider,
  experienceMd: string,
  screenId: string,
  clock?: Clock,
): Promise<ScreenRecord> {
  const manifest = readManifest(runFolder);
  const existing = manifest.screens.find((s) => s.screenId === screenId);
  if (!existing) throw new RegenError(`unknown screen: ${screenId}`, 'UNKNOWN_SCREEN');

  // Preserve the prior take's bytes before regenerating (non-destructive).
  const version = (existing.regenCount ?? 0) + 1;
  if (existing.htmlPath) {
    const src = join(runFolder, existing.htmlPath);
    if (existsSync(src)) copyFileSync(src, join(runFolder, `${screenId}.v${version}.html`));
  }

  const rec = await regenScreen(runFolder, provider, experienceMd, screenId, clock);
  appendLog(runFolder, { event: 'variant', screenId, detail: { preserved: `${screenId}.v${version}.html` } }, clock);
  return rec;
}
