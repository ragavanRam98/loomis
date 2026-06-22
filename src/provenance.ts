// Provenance (FR-13): resolve each screen to the story it satisfies and each story to its
// screen(s), detect per-screen omissions (requested content absent from the returned HTML),
// and surface dangling story references. All pure projections over the manifest.

import type { Manifest } from './types';

export function screenToStory(manifest: Manifest): Record<string, string> {
  const out: Record<string, string> = {};
  for (const s of manifest.screens) {
    if (s.story) out[s.screenId] = s.story;
  }
  return out;
}

export function storyToScreens(manifest: Manifest): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const s of manifest.screens) {
    if (!s.story) continue;
    (out[s.story] ??= []).push(s.screenId);
  }
  return out;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&rarr;/g, '→')
    .replace(/&middot;/g, '·')
    .replace(/&hellip;/g, '…');
}

/** Normalize for substring matching: decode entities, collapse whitespace, lowercase. */
function normalizeForMatch(s: string): string {
  return decodeEntities(s).replace(/\s+/g, ' ').trim().toLowerCase();
}

/** Verbatim content items that were requested but are absent from the returned HTML.
 *  Entity- and whitespace-aware so "Help & docs" matches "Help &amp; docs" (no false positives). */
export function detectOmissions(html: string, expected: string[]): string[] {
  const hay = normalizeForMatch(html);
  return expected.filter((item) => item.length > 0 && !hay.includes(normalizeForMatch(item)));
}

/** Screens whose story reference is not in the discovered story set (reported as orphans in 3.4). */
export function danglingStories(manifest: Manifest, knownStoryIds: string[]): string[] {
  const known = new Set(knownStoryIds);
  return manifest.screens.filter((s) => s.story && !known.has(s.story)).map((s) => s.screenId);
}
