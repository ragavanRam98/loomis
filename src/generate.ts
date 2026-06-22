// Generate + ingest ONE screen (FR-4/5/6/18, NFR-1). Orchestrates the provider port,
// persists the real HTML + screenshot BYTES into the run folder, and records the screen
// in the manifest. A failure/timeout marks the screen `failed` without corrupting the run.

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readManifest, writeManifest, emptyManifest } from './manifest';
import { appendLog, progress } from './log';
import type { Clock } from './log';
import { hashInputs } from './hash';
import { detectOmissions } from './provenance';
import { TimeoutError } from './poll';
import type { UIProvider, GenerateOptions } from './provider/uiprovider';
import type { Manifest, ScreenRecord } from './types';

export interface GenerateInput {
  screenId: string;
  prompt: string;
  surface?: string;
  story?: string;
  /** Verbatim content the prompt requested; absent items are recorded as omissions. */
  expectedContent?: string[];
}

export interface GenerateRunOptions {
  clock?: Clock;
  /** Skip a screen that is already done with a matching input hash (FR-13 idempotency). */
  skipIfUnchanged?: boolean;
}

export async function generateOneScreen(
  runFolder: string,
  provider: UIProvider,
  input: GenerateInput,
  opts: GenerateRunOptions = {},
): Promise<ScreenRecord> {
  const { clock, skipIfUnchanged } = opts;
  let manifest: Manifest;
  try {
    manifest = readManifest(runFolder);
  } catch {
    manifest = emptyManifest();
  }
  if (!manifest.projectId) {
    throw new Error('no projectId in manifest - run design-system sync first');
  }
  const projectId = manifest.projectId;
  const designSystemId = manifest.designSystem?.assetId;
  const inputHash = hashInputs({
    prompt: input.prompt,
    designSystemId,
    designMdHash: manifest.designSystem?.designMdHash,
  });

  // Skip unchanged-and-done screens (idempotency) - zero provider calls.
  const existing = manifest.screens.find((s) => s.screenId === input.screenId);
  if (skipIfUnchanged && existing && existing.status === 'done' && existing.inputHash === inputHash) {
    appendLog(runFolder, { event: 'screen-skip', screenId: input.screenId }, clock);
    progress(`${input.screenId} - unchanged, skipped.`);
    return existing;
  }

  // Upsert a pending screen record.
  let record = existing;
  if (!record) {
    record = { screenId: input.screenId, status: 'pending' };
    manifest.screens.push(record);
  }
  // Apply provenance every run (records may have been pre-created by `enumerate`).
  if (input.surface) record.surface = input.surface;
  if (input.story) record.story = input.story;
  // Mark in-flight ON DISK before the long provider call, so the live progress board
  // (`loomis watch`) shows this screen actively weaving instead of sitting at pending.
  record.status = 'in-flight';
  record.inputHash = inputHash;
  writeManifest(runFolder, manifest);
  appendLog(runFolder, { event: 'screen-start', screenId: input.screenId }, clock);

  try {
    const genOpts: GenerateOptions = {};
    if (designSystemId) genOpts.designSystemId = designSystemId;
    const device = manifest.designSystem?.device;
    if (device) genOpts.device = device as GenerateOptions['device'];
    const handle = await provider.generateScreen(projectId, input.prompt, genOpts);
    record.providerScreen = handle.screenId;

    const result = await provider.awaitScreen(handle);

    const htmlPath = `${input.screenId}.html`;
    writeFileSync(join(runFolder, htmlPath), result.html, 'utf8');
    record.htmlPath = htmlPath;

    if (result.screenshot) {
      const screenshotPath = `${input.screenId}.png`;
      writeFileSync(join(runFolder, screenshotPath), result.screenshot);
      record.screenshotPath = screenshotPath;
    }

    record.status = 'done';
    if (input.expectedContent && input.expectedContent.length > 0) {
      const missing = detectOmissions(result.html, input.expectedContent);
      if (missing.length > 0) record.omissions = missing;
      else delete record.omissions; // repaired -> clear stale omissions
    }
    appendLog(runFolder, { event: 'screen-generated', screenId: input.screenId }, clock);
  } catch (e) {
    record.status = 'failed';
    const code = e instanceof TimeoutError ? 'TIMEOUT' : 'GENERATE_FAILED';
    appendLog(
      runFolder,
      {
        event: 'screen-failed',
        screenId: input.screenId,
        detail: { code, error: e instanceof Error ? e.message : String(e) },
      },
      clock,
    );
  }

  writeManifest(runFolder, manifest);
  return record;
}
