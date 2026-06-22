import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { discoverInputs, DiscoveryError } from '../src/discovery';

function tmp(): string {
  return mkdtempSync(join(tmpdir(), 'loomis-disc-'));
}

describe('discoverInputs (NFR-5, FR-16)', () => {
  it('finds DESIGN.md/EXPERIENCE.md inside a ux-* folder (filenames lack "ux")', () => {
    const root = tmp();
    try {
      const ux = join(root, 'ux-myapp-2026-06-17');
      mkdirSync(join(ux, 'stories'), { recursive: true });
      writeFileSync(join(ux, 'DESIGN.md'), '# design');
      writeFileSync(join(ux, 'EXPERIENCE.md'), '# experience');
      writeFileSync(join(ux, 'stories', 'today-story.md'), '# story');

      const inputs = discoverInputs(root);
      expect(inputs.designMd.endsWith('DESIGN.md')).toBe(true);
      expect(inputs.experienceMd.endsWith('EXPERIENCE.md')).toBe(true);
      expect(inputs.stories).toHaveLength(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('throws DiscoveryError when EXPERIENCE.md is missing (edge case)', () => {
    const root = tmp();
    try {
      writeFileSync(join(root, 'DESIGN.md'), '# design');
      expect(() => discoverInputs(root)).toThrowError(/EXPERIENCE/i);
      try {
        discoverInputs(root);
      } catch (e) {
        expect(e).toBeInstanceOf(DiscoveryError);
        expect((e as DiscoveryError).code).toBe('NO_EXPERIENCE_MD');
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
