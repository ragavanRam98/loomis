import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { estimateRun, recordApproval } from '../src/gate';
import { syncDesignSystem } from '../src/design-system';
import { generateOneScreen } from '../src/generate';
import { readManifest } from '../src/manifest';
import { FakeProvider } from '../src/provider/fake';

function tmp(): string {
  return mkdtempSync(join(tmpdir(), 'loomis-gate-'));
}

describe('approval gate (FR-7, NFR-4/6)', () => {
  it('estimateRun reports N screens -> ~N generations', () => {
    expect(estimateRun(5)).toEqual({ screens: 5, estimatedGenerations: 5 });
  });

  it('recordApproval writes the verdict to the manifest and logs it', async () => {
    const dir = tmp();
    try {
      const provider = new FakeProvider();
      await syncDesignSystem(dir, provider, '# DESIGN.md');
      await generateOneScreen(dir, provider, { screenId: 'today', surface: 'Today', prompt: 'x' });

      const rec = recordApproval(dir, 'today', 'approved');
      expect(rec.review).toEqual({ verdict: 'approved' });

      const m = readManifest(dir);
      expect(m.screens.find((s) => s.screenId === 'today')?.review?.verdict).toBe('approved');
      expect(readFileSync(join(dir, '.loomis-run.log'), 'utf8')).toContain('screen-review');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('regenerate re-runs only that screen (overwrite), leaving others untouched (FR-7)', async () => {
    const dir = tmp();
    try {
      const provider = new FakeProvider();
      await syncDesignSystem(dir, provider, '# DESIGN.md');
      await generateOneScreen(dir, provider, { screenId: 'a', prompt: 'x' });
      await generateOneScreen(dir, provider, { screenId: 'b', prompt: 'x' });
      const beforeB = readFileSync(join(dir, 'b.html'), 'utf8');

      // Regenerate 'a' only.
      await generateOneScreen(dir, provider, { screenId: 'a', prompt: 'x-again' });

      const m = readManifest(dir);
      expect(m.screens.filter((s) => s.status === 'done')).toHaveLength(2);
      expect(readFileSync(join(dir, 'b.html'), 'utf8')).toBe(beforeB); // b untouched
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
