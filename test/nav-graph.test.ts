import { describe, it, expect } from 'vitest';
import { deriveNavGraph } from '../src/nav-graph';

const SAMPLE = `## Information Architecture
| Surface | Reached from | Purpose |
|---|---|---|
| Today | App open | a |
| Projects | Sidebar | b |
| Project detail | Projects row | c |
| Search | ⌘K | d |`;

const ALL = ['today', 'projects', 'project-detail', 'search'];

describe('deriveNavGraph (FR-8, NFR-3)', () => {
  it('derives entry, edges, and unresolved from the IA', () => {
    const g = deriveNavGraph(SAMPLE, ALL);
    expect(g.entry).toContain('today');
    expect(g.edges).toContainEqual({ from: 'projects', to: 'project-detail' });
    // Sidebar (not a surface) and ⌘K (behavioral) are unresolved, not broken edges.
    expect(g.unresolved.length).toBe(2);
  });

  it('records an edge whose target has no screen as unresolved (no broken edge)', () => {
    const g = deriveNavGraph(SAMPLE, ['today', 'projects', 'search']); // project-detail missing
    expect(g.edges).not.toContainEqual({ from: 'projects', to: 'project-detail' });
    expect(g.unresolved.some((u) => u.includes('project-detail'))).toBe(true);
  });

  it('is deterministic across runs (stable ordering)', () => {
    expect(deriveNavGraph(SAMPLE, ALL)).toEqual(deriveNavGraph(SAMPLE, ALL));
  });

  it('synthesizes a back edge for a non-entry target (tracks back navigation)', () => {
    const S = `## Information Architecture
| Surface | Reached from | Purpose |
|---|---|---|
| Overview | App open | a |
| Detail | Overview | b |`;
    const g = deriveNavGraph(S, ['overview', 'detail']);
    expect(g.edges).toContainEqual({ from: 'overview', to: 'detail' });
    expect(g.edges).toContainEqual({ from: 'detail', to: 'overview' }); // back edge
  });

  it('includes per-surface Nav declarations as edges (sidebar/CTAs)', () => {
    const S = `## Information Architecture
| Surface | Reached from | Purpose |
|---|---|---|
| Dashboard | App open | a |
| Settings | Sidebar | b |

## Dashboard
Nav:
- Settings -> Settings

## Settings
Nav:
- Back -> Dashboard`;
    const g = deriveNavGraph(S, ['dashboard', 'settings']);
    expect(g.edges).toContainEqual({ from: 'dashboard', to: 'settings' }); // declared sidebar nav
    expect(g.edges).toContainEqual({ from: 'settings', to: 'dashboard' }); // explicit back
  });
});
