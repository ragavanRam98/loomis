// Serial batch generation (FR-4 scaled, concurrency = 1). Generates every enumerated
// surface in order; a single failure is recorded and the batch continues (never aborts).

import { generateOneScreen } from './generate';
import { compileAll } from './compile';
import { readManifest, emptyManifest } from './manifest';
import { appendLog, progress } from './log';
import type { Clock } from './log';
import type { UIProvider } from './provider/uiprovider';
import type { Manifest, ScreenRecord } from './types';

export async function batchGenerate(
  runFolder: string,
  provider: UIProvider,
  experienceMd: string,
  clock?: Clock,
  skipIfUnchanged = true,
): Promise<ScreenRecord[]> {
  let manifest: Manifest;
  try {
    manifest = readManifest(runFolder);
  } catch {
    manifest = emptyManifest();
  }
  const designSystemId = manifest.designSystem?.assetId;

  const screens = compileAll(experienceMd, designSystemId);
  const results: ScreenRecord[] = [];
  progress(`Generating ${screens.length} screen(s) serially…`);

  for (let i = 0; i < screens.length; i += 1) {
    const c = screens[i]!;
    progress(`[${i + 1}/${screens.length}] ${c.surface} - generating (provider call ≈ 70s)…`);
    const rec = await generateOneScreen(
      runFolder,
      provider,
      {
        screenId: c.screenId,
        surface: c.surface,
        prompt: c.prompt,
        expectedContent: c.expectedContent,
        ...(c.story ? { story: c.story } : {}),
      },
      { clock, skipIfUnchanged },
    );
    progress(`[${i + 1}/${screens.length}] ${c.surface} - ${rec.status}`);
    results.push(rec);
  }
  progress(
    `Generation complete: ${results.filter((r) => r.status === 'done').length} done, ${results.filter((r) => r.status === 'failed').length} failed.`,
  );

  appendLog(
    runFolder,
    {
      event: 'batch-generate',
      detail: { total: screens.length, done: results.filter((r) => r.status === 'done').length },
    },
    clock,
  );
  return results;
}
