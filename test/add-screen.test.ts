import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { syncDesignSystem } from '../src/design-system';
import { generateOneScreen } from '../src/generate';
import { addScreen, deriveSurface } from '../src/add-screen';
import { readManifest } from '../src/manifest';
import { FakeProvider } from '../src/provider/fake';

const EXP = [
  '# EXPERIENCE',
  '',
  '## Information Architecture',
  '',
  '| Surface | Reached from | Purpose |',
  '|---|---|---|',
  '| Profile | App open | the profile |',
  '',
  '## Profile',
  'Purpose: the profile',
  'Layout:',
  '- a header',
  '',
].join('\n');

function tmp(): string {
  return mkdtempSync(join(tmpdir(), 'loomis-add-'));
}

describe('deriveSurface (naming the new screen)', () => {
  it('lifts a known qualifier from the instruction', () => {
    expect(deriveSurface('Profile', 'show me the light mode', new Set())).toBe('Profile (Light)');
  });
  it('falls back to a numbered name and avoids collisions', () => {
    expect(deriveSurface('Profile', 'just another take', new Set(['profile 2']))).toBe('Profile 3');
    expect(deriveSurface('Profile', 'light', new Set(['profile (light)']))).toBe('Profile (Light 2)');
  });
});

describe('addScreen (additive - grow the prototype)', () => {
  it('generates a NEW screen from a base + modifier, without touching the base', async () => {
    const dir = tmp();
    try {
      const provider = new FakeProvider();
      await syncDesignSystem(dir, provider, '# DESIGN.md\nname: Demo');
      await generateOneScreen(dir, provider, { screenId: 'profile', surface: 'Profile', prompt: 'P' });
      const before = readManifest(dir);
      const baseHtml = before.screens.find((s) => s.screenId === 'profile')!.htmlPath;
      const gensBefore = provider.calls.generateScreen;

      const r = await addScreen(dir, provider, EXP, 'profile', 'show me the light mode');
      expect(r.surface).toBe('Profile (Light)');
      expect(r.screenId).toBe('profile-light');

      const after = readManifest(dir);
      expect(after.screens).toHaveLength(2);
      const created = after.screens.find((s) => s.screenId === r.screenId)!;
      expect(created.status).toBe('done');
      expect(created.surface).toBe('Profile (Light)');
      // The base screen is untouched - same surface, same bytes.
      const base = after.screens.find((s) => s.screenId === 'profile')!;
      expect(base.surface).toBe('Profile');
      expect(base.htmlPath).toBe(baseHtml);
      expect(provider.calls.generateScreen).toBe(gensBefore + 1); // exactly one new generation
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects an unknown base screen', async () => {
    const dir = tmp();
    try {
      const provider = new FakeProvider();
      await syncDesignSystem(dir, provider, '# DESIGN.md');
      await expect(addScreen(dir, provider, EXP, 'nope', 'light')).rejects.toThrow(/unknown base/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
