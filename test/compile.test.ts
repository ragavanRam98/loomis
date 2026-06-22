import { describe, it, expect } from 'vitest';
import { parseSurfaceSpec } from '../src/experience';
import { compileScreen } from '../src/compile';

const EXP = `## Information Architecture
| Surface | Reached from | Purpose |
|---|---|---|
| Today | App open | Home |
| Task detail | Today | Edit |

## Today
Purpose: See today's tasks.
Story: today-list
Layout:
- Top app bar
- A list of task rows
Microcopy:
- title: "Cadence"
- empty: "Nothing due today. Enjoy the calm."
- addButton: "Add task"
States:
- empty: show the empty message
Nav:
- A task row -> Task detail
- Add button -> Add task
`;

describe('parseSurfaceSpec + compileScreen (EXPERIENCE.md -> prompt)', () => {
  it('parses purpose, story, layout, microcopy, states, nav for a surface', () => {
    const spec = parseSurfaceSpec(EXP, 'Today');
    expect(spec.purpose).toBe("See today's tasks.");
    expect(spec.story).toBe('today-list');
    expect(spec.regions).toEqual(['Top app bar', 'A list of task rows']);
    expect(spec.microcopy).toEqual({
      title: 'Cadence',
      empty: 'Nothing due today. Enjoy the calm.',
      addButton: 'Add task',
    });
    expect(spec.states).toEqual(['empty: show the empty message']);
    expect(spec.navTargets).toEqual([
      { label: 'A task row', target: 'task-detail' },
      { label: 'Add button', target: 'add-task' },
    ]);
  });

  it('compiles a faithful prompt carrying microcopy + nav hooks; expectedContent = microcopy', () => {
    const c = compileScreen(EXP, 'Today', 'assets/abc');
    expect(c.screenId).toBe('today');
    expect(c.story).toBe('today-list');
    expect(c.prompt).toContain('"Cadence"');
    expect(c.prompt).toContain('Nothing due today. Enjoy the calm.');
    expect(c.prompt).toContain('data-nav="task-detail"');
    expect(c.prompt).toContain('DESIGN SYSTEM: assets/abc');
    expect(c.expectedContent).toContain('Cadence');
    expect(c.expectedContent).toContain('Add task');
  });

  it('returns an empty spec for a surface with no section', () => {
    expect(parseSurfaceSpec(EXP, 'Nonexistent')).toEqual({
      regions: [],
      microcopy: {},
      states: [],
      navTargets: [],
      refinements: [],
    });
  });
});
