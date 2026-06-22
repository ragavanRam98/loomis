import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateOneScreen } from '../src/generate';
import { syncDesignSystem } from '../src/design-system';
import { readManifest } from '../src/manifest';
import { FakeProvider } from '../src/provider/fake';
import { TimeoutError } from '../src/poll';
import type { ScreenResult } from '../src/provider/uiprovider';

/** A provider whose generation always times out, to exercise the failure path. */
class FailingAwaitProvider extends FakeProvider {
  override async awaitScreen(): Promise<ScreenResult> {
    throw new TimeoutError();
  }
}

function tmp(): string {
  return mkdtempSync(join(tmpdir(), 'loomis-gen-'));
}

describe('generateOneScreen (FR-4/5/6/18, NFR-1)', () => {
  it('generates and ingests one screen (bytes persisted, status done)', async () => {
    const dir = tmp();
    try {
      const provider = new FakeProvider();
      await syncDesignSystem(dir, provider, '# DESIGN.md'); // sets projectId + pinned assetId

      const rec = await generateOneScreen(dir, provider, {
        screenId: 'today',
        surface: 'Today',
        story: 'story-1',
        prompt: 'SCREEN: Today',
      });

      expect(rec.status).toBe('done');
      expect(rec.htmlPath).toBe('today.html');
      expect(rec.screenshotPath).toBe('today.png');
      expect(existsSync(join(dir, 'today.html'))).toBe(true);
      expect(existsSync(join(dir, 'today.png'))).toBe(true);
      expect(readFileSync(join(dir, 'today.html'), 'utf8')).toContain('data-nav');

      const m = readManifest(dir);
      expect(m.screens.find((s) => s.screenId === 'today')?.status).toBe('done');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('a generation timeout marks the screen failed without corrupting the run (FR-18/NFR-1)', async () => {
    const dir = tmp();
    try {
      const provider = new FailingAwaitProvider();
      await syncDesignSystem(dir, provider, '# DESIGN.md');

      const rec = await generateOneScreen(dir, provider, { screenId: 'today', surface: 'Today', prompt: 'x' });

      expect(rec.status).toBe('failed');
      const m = readManifest(dir); // still schema-valid
      expect(m.screens.find((s) => s.screenId === 'today')?.status).toBe('failed');
      expect(existsSync(join(dir, 'today.html'))).toBe(false); // nothing half-written
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('malformed/empty DESIGN.md fails fast BEFORE any project is created (FR-18)', async () => {
    const dir = tmp();
    try {
      const provider = new FakeProvider();
      await expect(syncDesignSystem(dir, provider, '   ')).rejects.toThrow(/DESIGN\.md/i);
      expect(provider.calls.createProject).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
