import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { regenScreen, variantScreen } from '../src/regen';
import { recordApproval } from '../src/gate';
import { syncDesignSystem } from '../src/design-system';
import { batchGenerate } from '../src/batch';
import { writeNavGraph } from '../src/nav-graph';
import { readManifest } from '../src/manifest';
import { FakeProvider } from '../src/provider/fake';

const SAMPLE = `## Information Architecture
| Surface | Reached from | Purpose |
|---|---|---|
| Today | App open | a |
| Projects | Today | b |`;

function tmp(): string {
  return mkdtempSync(join(tmpdir(), 'loomis-regen-'));
}

async function setup(provider: FakeProvider): Promise<string> {
  const dir = tmp();
  await syncDesignSystem(dir, provider, '# DESIGN.md');
  await batchGenerate(dir, provider, SAMPLE);
  writeNavGraph(dir, SAMPLE);
  return dir;
}

describe('regen / variant (FR-12, FR-13, FR-17)', () => {
  it('regen forces regeneration past the hash-skip and bumps regenCount; graph preserved', async () => {
    const provider = new FakeProvider();
    const dir = await setup(provider);
    try {
      const edgesBefore = JSON.stringify(readManifest(dir).edges);
      const callsBefore = provider.calls.generateScreen;

      const rec = await regenScreen(dir, provider, SAMPLE, 'today');

      expect(provider.calls.generateScreen).toBe(callsBefore + 1); // forced (would have skipped)
      expect(rec.regenCount).toBe(1);
      expect(JSON.stringify(readManifest(dir).edges)).toBe(edgesBefore); // page-graph untouched
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('variant preserves the prior take bytes (non-destructive)', async () => {
    const provider = new FakeProvider();
    const dir = await setup(provider);
    try {
      const beforeBytes = readFileSync(join(dir, 'today.html'), 'utf8');

      const rec = await variantScreen(dir, provider, SAMPLE, 'today');

      expect(existsSync(join(dir, 'today.v1.html'))).toBe(true);
      expect(readFileSync(join(dir, 'today.v1.html'), 'utf8')).toBe(beforeBytes); // prior take kept
      expect(rec.regenCount).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('regen on an unknown screen makes no provider call and throws UNKNOWN_SCREEN', async () => {
    const provider = new FakeProvider();
    const dir = await setup(provider);
    try {
      const calls = provider.calls.generateScreen;
      await expect(regenScreen(dir, provider, SAMPLE, 'nonexistent')).rejects.toThrow(/unknown/i);
      expect(provider.calls.generateScreen).toBe(calls); // no provider call, no byte mutation
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reject records the verdict in the manifest', async () => {
    const provider = new FakeProvider();
    const dir = await setup(provider);
    try {
      recordApproval(dir, 'today', 'rejected', 'off-brand');
      const m = readManifest(dir);
      expect(m.screens.find((s) => s.screenId === 'today')?.review).toEqual({
        verdict: 'rejected',
        reason: 'off-brand',
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
