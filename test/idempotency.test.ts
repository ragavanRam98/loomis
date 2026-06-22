import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateOneScreen } from '../src/generate';
import { syncDesignSystem } from '../src/design-system';
import { FakeProvider } from '../src/provider/fake';
import type { GenerateOptions, ScreenHandle } from '../src/provider/uiprovider';

/** Fails the very first generateScreen call, succeeds afterwards. */
class FailFirstProvider extends FakeProvider {
  override async generateScreen(p: string, prompt: string, o?: GenerateOptions): Promise<ScreenHandle> {
    if (this.calls.generateScreen === 0) {
      this.calls.generateScreen += 1;
      throw new Error('boom');
    }
    return super.generateScreen(p, prompt, o);
  }
}

function tmp(): string {
  return mkdtempSync(join(tmpdir(), 'loomis-idem-'));
}

describe('input-hash idempotency (FR-13, FR-12, FR-3)', () => {
  it('skips an unchanged-and-done screen on re-run (zero new generateScreen calls)', async () => {
    const dir = tmp();
    try {
      const provider = new FakeProvider();
      await syncDesignSystem(dir, provider, '# DESIGN.md');
      await generateOneScreen(dir, provider, { screenId: 'today', surface: 'Today', prompt: 'P' });
      expect(provider.calls.generateScreen).toBe(1);

      await generateOneScreen(dir, provider, { screenId: 'today', surface: 'Today', prompt: 'P' }, { skipIfUnchanged: true });
      expect(provider.calls.generateScreen).toBe(1); // skipped - no new call
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('regenerates when the prompt changes (hash differs)', async () => {
    const dir = tmp();
    try {
      const provider = new FakeProvider();
      await syncDesignSystem(dir, provider, '# DESIGN.md');
      await generateOneScreen(dir, provider, { screenId: 'today', prompt: 'P' });
      await generateOneScreen(dir, provider, { screenId: 'today', prompt: 'P2' }, { skipIfUnchanged: true });
      expect(provider.calls.generateScreen).toBe(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('a DESIGN.md edit invalidates the cache and regenerates (FR-3)', async () => {
    const dir = tmp();
    try {
      const provider = new FakeProvider();
      await syncDesignSystem(dir, provider, '# v1');
      await generateOneScreen(dir, provider, { screenId: 'today', prompt: 'P' });
      const before = provider.calls.generateScreen;

      await syncDesignSystem(dir, provider, '# v2 changed'); // new designMdHash
      await generateOneScreen(dir, provider, { screenId: 'today', prompt: 'P' }, { skipIfUnchanged: true });
      expect(provider.calls.generateScreen).toBe(before + 1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reuses the pinned design system when DESIGN.md is unchanged (no new sync call)', async () => {
    const dir = tmp();
    try {
      const provider = new FakeProvider();
      await syncDesignSystem(dir, provider, '# DESIGN.md\nname: X');
      expect(provider.calls.syncDesignSystem).toBe(1);

      // Identical DESIGN.md → reuse, not a fresh mint. This is what makes a studio relaunch a resume.
      await syncDesignSystem(dir, provider, '# DESIGN.md\nname: X');
      expect(provider.calls.syncDesignSystem).toBe(1); // reused - no new provider call
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('regenerates a failed screen even with skipIfUnchanged (failed != done)', async () => {
    const dir = tmp();
    try {
      const provider = new FailFirstProvider();
      await syncDesignSystem(dir, provider, '# DESIGN.md');
      const r1 = await generateOneScreen(dir, provider, { screenId: 'today', prompt: 'P' }, { skipIfUnchanged: true });
      expect(r1.status).toBe('failed');

      const r2 = await generateOneScreen(dir, provider, { screenId: 'today', prompt: 'P' }, { skipIfUnchanged: true });
      expect(r2.status).toBe('done'); // failed -> not skipped -> regenerated
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
