import { describe, it, expect } from 'vitest';
import { computeCoverage } from '../src/coverage';
import type { Manifest } from '../src/types';

function manifest(screens: Manifest['screens']): Manifest {
  return { entry: [], edges: [], unresolved: [], screens };
}

describe('computeCoverage (FR-14)', () => {
  it('reports full coverage with empty uncovered/orphans', () => {
    const m = manifest([
      { screenId: 'a', status: 'done', story: 'story-1' },
      { screenId: 'b', status: 'done', story: 'story-2' },
    ]);
    const r = computeCoverage(m, ['story-1', 'story-2']);
    expect(r.stories).toEqual({ 'story-1': ['a'], 'story-2': ['b'] });
    expect(r.uncovered).toEqual([]);
    expect(r.orphans).toEqual([]);
  });

  it('reports a story/surface with only a failed screen as uncovered (failed != coverage)', () => {
    const m = manifest([
      { screenId: 'a', status: 'done', story: 'story-1' },
      { screenId: 'b', status: 'failed', story: 'story-2' },
    ]);
    const r = computeCoverage(m, ['story-1', 'story-2']);
    expect(r.uncovered).toContain('story-2'); // only a failed screen
    expect(r.uncovered).toContain('b'); // surface not done
  });

  it('reports orphan screens with no story link', () => {
    const m = manifest([
      { screenId: 'a', status: 'done', story: 'story-1' },
      { screenId: 'orphan', status: 'done' },
    ]);
    expect(computeCoverage(m, ['story-1']).orphans).toEqual(['orphan']);
  });

  it('returns a well-formed report for an empty manifest (no throw)', () => {
    expect(computeCoverage(manifest([]))).toEqual({ stories: {}, uncovered: [], orphans: [] });
  });
});
