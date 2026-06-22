import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { batchGenerate } from '../src/batch';
import { syncDesignSystem } from '../src/design-system';
import { readManifest } from '../src/manifest';
import { FakeProvider } from '../src/provider/fake';
import type { GenerateOptions, ScreenHandle } from '../src/provider/uiprovider';

const SAMPLE = `## Information Architecture
| Surface | Reached from | Purpose |
|---|---|---|
| Today | App open | a |
| Projects | Sidebar | b |
| Settings | Sidebar | c |`;

/** Fails the Nth generateScreen call to exercise the continue-on-failure path. */
class FlakyProvider extends FakeProvider {
  constructor(private readonly failOnCall: number) {
    super();
  }
  override async generateScreen(
    projectId: string,
    prompt: string,
    opts?: GenerateOptions,
  ): Promise<ScreenHandle> {
    if (this.calls.generateScreen + 1 === this.failOnCall) {
      this.calls.generateScreen += 1;
      throw new Error('boom');
    }
    return super.generateScreen(projectId, prompt, opts);
  }
}

function tmp(): string {
  return mkdtempSync(join(tmpdir(), 'loomis-batch-'));
}

describe('batchGenerate (FR-4 scaled, serial)', () => {
  it('generates every enumerated surface serially (all done)', async () => {
    const dir = tmp();
    try {
      const provider = new FakeProvider();
      await syncDesignSystem(dir, provider, '# DESIGN.md');
      const results = await batchGenerate(dir, provider, SAMPLE);
      expect(results).toHaveLength(3);
      expect(results.every((r) => r.status === 'done')).toBe(true);
      const m = readManifest(dir);
      expect(m.screens.filter((r) => r.status === 'done')).toHaveLength(3);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('continues after one screen fails (failed recorded, others done)', async () => {
    const dir = tmp();
    try {
      const provider = new FlakyProvider(2); // 2nd generateScreen throws
      await syncDesignSystem(dir, provider, '# DESIGN.md');
      const results = await batchGenerate(dir, provider, SAMPLE);
      expect(results.map((r) => r.status)).toEqual(['done', 'failed', 'done']);
      const m = readManifest(dir);
      expect(m.screens.filter((r) => r.status === 'done')).toHaveLength(2);
      expect(m.screens.filter((r) => r.status === 'failed')).toHaveLength(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
