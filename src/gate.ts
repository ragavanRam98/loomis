// Approval gate building blocks (FR-7, NFR-4/6). The BLOCKING + the human prompt live in
// the agent layer (bmad-weave-ui); the deterministic core records the decision in the
// manifest and produces the pre-run estimate. Regeneration is just generateOneScreen again
// on the same screenId (overwrite-on-regen).

import { readManifest, writeManifest } from './manifest';
import { appendLog } from './log';
import type { Clock } from './log';
import type { ScreenRecord } from './types';

export type Verdict = 'approved' | 'rejected';

export interface RunEstimate {
  screens: number;
  /** N screens => ~N generations (1:1 in MVP). */
  estimatedGenerations: number;
}

export function estimateRun(surfaceCount: number): RunEstimate {
  return { screens: surfaceCount, estimatedGenerations: surfaceCount };
}

export function recordApproval(
  runFolder: string,
  screenId: string,
  verdict: Verdict,
  reason?: string,
  clock?: Clock,
): ScreenRecord {
  const manifest = readManifest(runFolder);
  const record = manifest.screens.find((s) => s.screenId === screenId);
  if (!record) {
    throw new Error(`screen not found in manifest: ${screenId}`);
  }
  record.review = { verdict };
  if (reason) record.review.reason = reason;
  writeManifest(runFolder, manifest);
  appendLog(runFolder, { event: 'screen-review', screenId, detail: { verdict } }, clock);
  return record;
}
