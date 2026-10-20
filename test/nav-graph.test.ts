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
    expect(g.edges).toContainEqual({ from: 'dashboard', to: 'settings', label: 'Settings' }); // declared sidebar nav
    expect(g.edges).toContainEqual({ from: 'settings', to: 'dashboard', label: 'Back' }); // explicit back
  });

  it('records the label a Nav line gives its link, on the IA edge for the same link too', () => {
    const S = `## Information Architecture
| Surface | Reached from | Purpose |
|---|---|---|
| Dashboard | App open | a |
| Requests | Dashboard | b |

## Dashboard
Nav:
- See the requests -> Requests

## Requests
Nav:
- Back to the dashboard -> Dashboard`;
    const g = deriveNavGraph(S, ['dashboard', 'requests']);
    expect(g.edges).toContainEqual({ from: 'dashboard', to: 'requests', label: 'See the requests' });
    expect(g.edges).toContainEqual({ from: 'requests', to: 'dashboard', label: 'Back to the dashboard' });
  });

  it('keeps every label when several Nav lines link the same two screens, the first as the label', () => {
    const S = `## Information Architecture
| Surface | Reached from | Purpose |
|---|---|---|
| Dashboard | App open | a |
| Refunds | Sidebar | b |

## Dashboard
Nav:
- Refunds -> Refunds
- See the refunds -> Refunds`;
    const g = deriveNavGraph(S, ['dashboard', 'refunds']);
    expect(g.edges.filter((e) => e.from === 'dashboard' && e.to === 'refunds')).toEqual([
      { from: 'dashboard', to: 'refunds', label: 'Refunds', labels: ['Refunds', 'See the refunds'] },
    ]);
  });

  it('synthesizes no back edge for a Nav link: a top-bar link to Profile is one-way', () => {
    const S = `## Information Architecture
| Surface | Reached from | Purpose |
|---|---|---|
| Home | App open | a |
| Report | Home | b |
| Profile | Home | c |

## Report
Nav:
- Profile -> Profile`;
    const g = deriveNavGraph(S, ['home', 'report', 'profile']);
    expect(g.edges.some((e) => e.from === 'report' && e.to === 'profile')).toBe(true);
    expect(g.edges.some((e) => e.from === 'profile' && e.to === 'report')).toBe(false);
  });

  it('synthesizes no back edge out of a surface whose Nav list declares its links', () => {
    const S = `## Information Architecture
| Surface | Reached from | Purpose |
|---|---|---|
| Sign in | App open | a |
| Sign up | Sign in | b |
| Confirm email | Sign up | c |

## Confirm email
Nav:
- Sign in -> Sign in`;
    const g = deriveNavGraph(S, ['sign-in', 'sign-up', 'confirm-email']);
    expect(g.edges).toContainEqual({ from: 'sign-up', to: 'confirm-email' });
    expect(g.edges.some((e) => e.from === 'confirm-email' && e.to === 'sign-up')).toBe(false);
    // Sign up declares no Nav list, so its way back to Sign in is still tracked.
    expect(g.edges).toContainEqual({ from: 'sign-up', to: 'sign-in' });
  });
});
