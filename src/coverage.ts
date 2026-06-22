// Coverage (FR-14): prove every targeted surface/story maps to a done screen; list any
// uncovered ones and flag orphan screens (done screens with no story link). Pure function
// over the manifest - a failed screen never counts as coverage.

import type { Manifest } from './types';

export interface CoverageReport {
  /** story -> the done screen ids that satisfy it. */
  stories: Record<string, string[]>;
  /** targeted surfaces/stories with no done screen (gaps). */
  uncovered: string[];
  /** done screens with no story link (orphans). */
  orphans: string[];
}

export function computeCoverage(manifest: Manifest, knownStoryIds: string[] = []): CoverageReport {
  const doneScreens = manifest.screens.filter((s) => s.status === 'done');

  const stories: Record<string, string[]> = {};
  for (const s of doneScreens) {
    if (s.story) (stories[s.story] ??= []).push(s.screenId);
  }

  const uncovered = new Set<string>();
  // Known stories with no covering done screen.
  for (const story of knownStoryIds) {
    const covered = stories[story];
    if (!covered || covered.length === 0) uncovered.add(story);
  }
  // Targeted surfaces (any non-done screen record) are gaps.
  for (const s of manifest.screens) {
    if (s.status !== 'done') uncovered.add(s.screenId);
  }

  const orphans = doneScreens.filter((s) => !s.story).map((s) => s.screenId);

  return {
    stories,
    uncovered: [...uncovered].sort(),
    orphans: orphans.sort(),
  };
}
