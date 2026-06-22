// Reconcile (the second half of the hybrid loop). `refine` applies a live edit and records
// the feedback on the manifest; `reconcile` FOLDS that feedback back into EXPERIENCE.md under
// the screen's surface (as a `Refinements:` block the compiler reads), then clears it from the
// manifest - so the spec becomes the single source of truth and a clean re-weave reproduces the
// edited look. Traceability restored: no more untracked, manifest-only edits.

import { readFileSync, writeFileSync } from 'node:fs';
import { readManifest, writeManifest } from './manifest';
import { parseSurfaceSpec } from './experience';
import { appendLog } from './log';
import type { Clock } from './log';

export interface FoldedRefinement {
  screenId: string;
  surface: string;
  refinements: string[];
}

const norm = (s: string): string => s.trim().toLowerCase();

function sectionBounds(lines: string[], surface: string): { headingIdx: number; endIdx: number } | null {
  const headingIdx = lines.findIndex(
    (l) => /^#{2,4}\s+/.test(l) && l.replace(/^#{2,4}\s+/, '').trim().toLowerCase() === surface.toLowerCase(),
  );
  if (headingIdx === -1) return null;
  let endIdx = lines.length;
  for (let j = headingIdx + 1; j < lines.length; j += 1) {
    if (/^#{2,4}\s+/.test(lines[j] ?? '')) {
      endIdx = j;
      break;
    }
  }
  return { headingIdx, endIdx };
}

/** Append refinement bullets into a surface's `Refinements:` block (creating the section/block as needed). */
function foldIntoSurface(md: string, surface: string, bullets: string[]): string {
  const lines = md.split('\n');
  const block = bullets.map((b) => `- ${b}`);
  const bounds = sectionBounds(lines, surface);

  if (!bounds) {
    // No detail section for this surface - append a fresh one at EOF.
    return [...lines, '', `## ${surface}`, 'Refinements:', ...block].join('\n');
  }

  // Merge into an existing `Refinements:` block if the surface already has one.
  let refIdx = -1;
  for (let j = bounds.headingIdx + 1; j < bounds.endIdx; j += 1) {
    if (/^\s*refinements:?\s*$/i.test(lines[j] ?? '')) {
      refIdx = j;
      break;
    }
  }
  if (refIdx !== -1) {
    let ins = refIdx + 1;
    while (ins < bounds.endIdx && /^\s*[-*]\s+/.test(lines[ins] ?? '')) ins += 1;
    lines.splice(ins, 0, ...block);
    return lines.join('\n');
  }

  // No block yet - insert one at the end of the surface section (after its last non-blank line).
  let ins = bounds.endIdx;
  while (ins - 1 > bounds.headingIdx && (lines[ins - 1] ?? '').trim() === '') ins -= 1;
  lines.splice(ins, 0, '', 'Refinements:', ...block);
  return lines.join('\n');
}

/**
 * Fold each screen's recorded refinements into EXPERIENCE.md, then clear them from the manifest.
 * Scoped to one screen when `screenId` is given. Returns what was folded (empty if nothing pending).
 */
export function reconcileSpec(
  runFolder: string,
  experienceMdPath: string,
  screenId?: string,
  clock?: Clock,
): { folded: FoldedRefinement[]; experienceMd: string } {
  const manifest = readManifest(runFolder);
  let md = readFileSync(experienceMdPath, 'utf8');
  const folded: FoldedRefinement[] = [];

  const targets = manifest.screens.filter(
    (s) => s.refinements && s.refinements.length > 0 && s.surface && (!screenId || s.screenId === screenId),
  );

  for (const s of targets) {
    const surface = s.surface as string;
    const already = new Set(parseSurfaceSpec(md, surface).refinements.map(norm));
    const fresh = (s.refinements ?? []).filter((r) => !already.has(norm(r)));
    if (fresh.length > 0) md = foldIntoSurface(md, surface, fresh);
    folded.push({ screenId: s.screenId, surface, refinements: s.refinements ?? [] });
    // Now lives in the spec - drop the manifest copy so the `refinements` nudge goes quiet.
    delete s.refinements;
  }

  if (folded.length > 0) {
    writeFileSync(experienceMdPath, md, 'utf8');
    writeManifest(runFolder, manifest);
    appendLog(runFolder, { event: 'reconcile', detail: { folded: folded.map((f) => f.screenId) } }, clock);
  }

  return { folded, experienceMd: experienceMdPath };
}
