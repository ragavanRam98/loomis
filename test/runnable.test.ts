import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkRunnable } from '../src/runnable';
import { syncDesignSystem } from '../src/design-system';
import { batchGenerate } from '../src/batch';
import { writeNavGraph } from '../src/nav-graph';
import { wireRunFolder } from '../src/wire';
import { assembleBundle } from '../src/assemble';
import { writeManifest, emptyManifest } from '../src/manifest';
import { FakeProvider } from '../src/provider/fake';
import type { GenerateOptions, ScreenHandle } from '../src/provider/uiprovider';

const SAMPLE3 = `## Information Architecture
| Surface | Reached from | Purpose |
|---|---|---|
| Today | App open | a |
| Projects | Today | b |
| Settings | Today | c |`;

class FlakyProvider extends FakeProvider {
  constructor(private readonly failOnCall: number) {
    super();
  }
  override async generateScreen(p: string, prompt: string, o?: GenerateOptions): Promise<ScreenHandle> {
    if (this.calls.generateScreen + 1 === this.failOnCall) {
      this.calls.generateScreen += 1;
      throw new Error('boom');
    }
    return super.generateScreen(p, prompt, o);
  }
}

function tmp(): string {
  return mkdtempSync(join(tmpdir(), 'loomis-run-'));
}

async function buildBundle(dir: string, provider: FakeProvider): Promise<void> {
  await syncDesignSystem(dir, provider, '# DESIGN.md');
  await batchGenerate(dir, provider, SAMPLE3);
  writeNavGraph(dir, SAMPLE3);
  wireRunFolder(dir);
  await assembleBundle(dir, { vendor: false });
}

describe('runnability gate (FR-9/10, NFR-2/3)', () => {
  it('linkinator is green over a fully-done bundle', async () => {
    const dir = tmp();
    try {
      await buildBundle(dir, new FakeProvider());
      const r = await checkRunnable(join(dir, 'out'));
      expect(r.broken).toEqual([]);
      expect(r.passed).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30000);

  it('linkinator stays green for a half-failed run (subset of done screens)', async () => {
    const dir = tmp();
    try {
      await buildBundle(dir, new FlakyProvider(2)); // Projects fails mid-batch
      const r = await checkRunnable(join(dir, 'out'));
      expect(r.broken).toEqual([]);
      expect(r.passed).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30000);

  it('wire and assemble are total functions over an empty manifest (no crash)', async () => {
    const dir = tmp();
    try {
      writeManifest(dir, emptyManifest());
      expect(() => wireRunFolder(dir)).not.toThrow();
      const r = await assembleBundle(dir, { vendor: false });
      expect(r.screens).toBe(0);
      expect(existsSync(join(dir, 'out', 'index.html'))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
