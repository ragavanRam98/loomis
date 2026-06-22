// Surface enumeration (FR-8 first half): EXPERIENCE.md IA -> stable screen ids, written
// as pending records into the manifest so coverage knows the targets up front.

import { slugify } from './slug';
import { parseIaTable } from './experience';
import { readManifest, writeManifest, emptyManifest } from './manifest';
import { appendLog } from './log';
import type { Clock } from './log';
import type { Manifest, ScreenRecord } from './types';

export interface EnumeratedSurface {
  screenId: string;
  surface: string;
  reachedFrom: string;
}

export function enumerateSurfaces(experienceMd: string): EnumeratedSurface[] {
  return parseIaTable(experienceMd).map((r) => ({
    screenId: slugify(r.surface),
    surface: r.surface,
    reachedFrom: r.reachedFrom,
  }));
}

export function enumerateIntoManifest(
  runFolder: string,
  experienceMd: string,
  clock?: Clock,
): EnumeratedSurface[] {
  let manifest: Manifest;
  try {
    manifest = readManifest(runFolder);
  } catch {
    manifest = emptyManifest();
  }

  const surfaces = enumerateSurfaces(experienceMd);
  for (const s of surfaces) {
    if (!manifest.screens.find((r) => r.screenId === s.screenId)) {
      const rec: ScreenRecord = { screenId: s.screenId, surface: s.surface, status: 'pending' };
      manifest.screens.push(rec);
    }
  }

  writeManifest(runFolder, manifest);
  appendLog(runFolder, { event: 'enumerate', detail: { count: surfaces.length } }, clock);
  return surfaces;
}
