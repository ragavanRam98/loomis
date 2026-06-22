import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { repairScreens } from '../src/repair';
import { generateOneScreen } from '../src/generate';
import { syncDesignSystem } from '../src/design-system';
import { readManifest } from '../src/manifest';
import { FakeProvider } from '../src/provider/fake';
import type { GenerateOptions, ScreenHandle } from '../src/provider/uiprovider';

/** Captures the prompt passed to generateScreen. */
class PromptCapturingProvider extends FakeProvider {
  lastPrompt = '';
  override async generateScreen(p: string, prompt: string, o?: GenerateOptions): Promise<ScreenHandle> {
    this.lastPrompt = prompt;
    return super.generateScreen(p, prompt, o);
  }
}

const EXP = `## Information Architecture
| Surface | Reached from | Purpose |
|---|---|---|
| Home | App open | x |

## Home
Microcopy:
- banner: "Special Banner Text"`;

describe('repairScreens (omission self-correction)', () => {
  it('regenerates screens with omissions, re-emphasising the missing content', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'loomis-repair-'));
    try {
      const provider = new PromptCapturingProvider();
      await syncDesignSystem(dir, provider, '# DESIGN.md');

      // The FAKE's HTML won't contain this string -> it's recorded as an omission.
      await generateOneScreen(dir, provider, {
        screenId: 'home',
        surface: 'Home',
        prompt: 'P',
        expectedContent: ['Special Banner Text'],
      });
      expect(readManifest(dir).screens.find((s) => s.screenId === 'home')?.omissions).toContain(
        'Special Banner Text',
      );

      const r = await repairScreens(dir, provider, EXP);
      expect(r.repaired).toContain('home');
      // The repair prompt re-states the missing content verbatim.
      expect(provider.lastPrompt).toContain('MUST INCLUDE');
      expect(provider.lastPrompt).toContain('Special Banner Text');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('is a no-op when there are no omissions', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'loomis-repair2-'));
    try {
      const provider = new FakeProvider();
      await syncDesignSystem(dir, provider, '# DESIGN.md');
      await generateOneScreen(dir, provider, { screenId: 'home', surface: 'Home', prompt: 'P' });
      expect((await repairScreens(dir, provider, EXP)).repaired).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
