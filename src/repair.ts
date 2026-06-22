// Omission repair (self-correction): screens that came back missing requested verbatim
// content get ONE regeneration with the missing items re-emphasized in the prompt. Bounded
// to a single pass - no infinite loops; the re-run re-detects (and clears) omissions.

import { readManifest } from './manifest';
import { compileScreen } from './compile';
import { generateOneScreen } from './generate';
import { appendLog, progress } from './log';
import type { Clock } from './log';
import type { UIProvider } from './provider/uiprovider';

export async function repairScreens(
  runFolder: string,
  provider: UIProvider,
  experienceMd: string,
  clock?: Clock,
): Promise<{ repaired: string[] }> {
  const manifest = readManifest(runFolder);
  const designSystemId = manifest.designSystem?.assetId;
  const repaired: string[] = [];

  for (const s of manifest.screens) {
    if (s.status !== 'done' || !s.omissions?.length || !s.surface) continue;
    progress(`Repairing ${s.screenId} - ${s.omissions.length} missing item(s)…`);
    const compiled = compileScreen(experienceMd, s.surface, designSystemId);
    const missing = s.omissions.map((m) => `  - "${m}"`).join('\n');
    const repairPrompt = `${compiled.prompt}\n\nMUST INCLUDE (these were missing last time - include them verbatim):\n${missing}`;

    await generateOneScreen(
      runFolder,
      provider,
      {
        screenId: s.screenId,
        surface: compiled.surface,
        prompt: repairPrompt,
        expectedContent: compiled.expectedContent,
        ...(compiled.story ? { story: compiled.story } : {}),
      },
      { clock, skipIfUnchanged: false },
    );
    repaired.push(s.screenId);
  }

  appendLog(runFolder, { event: 'repair', detail: { repaired: repaired.length } }, clock);
  return { repaired };
}
