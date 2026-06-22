import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { enumerateSurfaces, enumerateIntoManifest } from '../src/enumerate';
import { readManifest } from '../src/manifest';

const SAMPLE = `## Information Architecture
| Surface | Reached from | Purpose |
|---|---|---|
| Today | App open | focus |
| Project detail | Projects | tasks |`;

describe('enumerateSurfaces / enumerateIntoManifest (FR-8)', () => {
  it('maps IA surfaces to stable screen ids via slugify', () => {
    const surfaces = enumerateSurfaces(SAMPLE);
    expect(surfaces.map((s) => s.screenId)).toEqual(['today', 'project-detail']);
  });

  it('writes pending records into the manifest (idempotent - no dupes on re-run)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'loomis-enum-'));
    try {
      enumerateIntoManifest(dir, SAMPLE);
      enumerateIntoManifest(dir, SAMPLE);
      const m = readManifest(dir);
      expect(m.screens.map((r) => r.screenId)).toEqual(['today', 'project-detail']);
      expect(m.screens.every((r) => r.status === 'pending')).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
