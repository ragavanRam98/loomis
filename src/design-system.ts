// Design System Sync (FR-1/2/3): turn DESIGN.md into a pinned provider design system,
// recorded in the manifest. DESIGN.md stays the source of truth; on every run we
// re-instantiate via the provider (never a designMd<->designMd text diff).

import { readManifest, writeManifest, emptyManifest } from './manifest';
import { appendLog, progress } from './log';
import type { Clock } from './log';
import { hashInputs } from './hash';
import { ProviderError } from './provider/transport';
import type { UIProvider } from './provider/uiprovider';
import type { Manifest } from './types';

/** Fail fast on a missing/empty DESIGN.md BEFORE any provider project is created (FR-18). */
export function assertDesignMd(designMd: string): void {
  if (!designMd || !designMd.trim()) {
    throw new ProviderError('DESIGN.md is empty or unreadable', 'BAD_DESIGN_MD');
  }
}

const DEVICES = new Set(['mobile', 'desktop', 'tablet', 'agnostic']);

/** Read an optional `device:` directive from DESIGN.md (mobile/desktop/tablet/agnostic). */
export function parseDevice(designMd: string): string | undefined {
  const m = designMd.match(/^\s*device:\s*"?([a-zA-Z]+)"?\s*$/im);
  const v = m?.[1]?.toLowerCase();
  return v && DEVICES.has(v) ? v : undefined;
}

/** Read the app `name:` from DESIGN.md so the provider project is named after the app. */
export function parseName(designMd: string): string | undefined {
  const m = designMd.match(/^\s*name:\s*"?(.+?)"?\s*$/im);
  const v = m?.[1]?.trim();
  return v && v.length > 0 ? v : undefined;
}

export async function syncDesignSystem(
  runFolder: string,
  provider: UIProvider,
  designMd: string,
  clock?: Clock,
): Promise<Manifest> {
  assertDesignMd(designMd); // before any project is created

  let manifest: Manifest;
  try {
    manifest = readManifest(runFolder);
  } catch {
    manifest = emptyManifest();
  }

  // Idempotent reuse (FR-3 / studio resume): if DESIGN.md is byte-for-byte unchanged since the
  // last sync, KEEP the pinned design system instead of minting a fresh asset. This is what makes
  // a studio relaunch a RESUME rather than a re-weave - the per-screen input hashes stay stable,
  // so already-done screens skip. A real DESIGN.md edit changes the hash and forces a fresh sync.
  const designMdHash = hashInputs(designMd);
  if (manifest.designSystem?.assetId && manifest.designSystem.designMdHash === designMdHash) {
    progress('Design system unchanged - reusing the pinned one.');
    appendLog(runFolder, { event: 'design-system-reuse', detail: { assetId: manifest.designSystem.assetId } }, clock);
    return manifest;
  }

  // Ensure a project exists, NAMED after the app (reused across runs - no delete API).
  if (!manifest.projectId) {
    progress(`Creating provider project "${parseName(designMd) ?? 'Untitled'}"…`);
    manifest.projectId = await provider.createProject(parseName(designMd));
  }

  // Re-instantiate the design system from DESIGN.md (FR-3: fresh call, not a blob diff).
  progress('Instantiating + reading back the design system from DESIGN.md…');
  const { assetId, roleMap, resolved } = await provider.syncDesignSystem(manifest.projectId, designMd);
  const device = parseDevice(designMd);
  manifest.designSystem = {
    assetId,
    source: 'DESIGN.md',
    roleMap,
    designMdHash,
    ...(device ? { device } : {}),
    ...(resolved ? { resolved } : {}),
  };

  writeManifest(runFolder, manifest);
  appendLog(runFolder, { event: 'design-system-sync', detail: { assetId } }, clock);
  return manifest;
}
