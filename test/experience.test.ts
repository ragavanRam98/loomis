import { describe, it, expect } from 'vitest';
import { parseIaTable } from '../src/experience';

const SAMPLE = `# Experience

## Information Architecture

| Surface | Reached from | Purpose |
|---|---|---|
| Today | App open | Current focus |
| Projects | Sidebar | List of projects |
| Project detail | Projects row | Tasks in a project |

## Notes
other stuff`;

describe('parseIaTable', () => {
  it('parses the IA table rows (surface, reached from, purpose)', () => {
    const rows = parseIaTable(SAMPLE);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual({ surface: 'Today', reachedFrom: 'App open', purpose: 'Current focus' });
    expect(rows[2]?.surface).toBe('Project detail');
  });

  it('returns [] when no IA table is present', () => {
    expect(parseIaTable('# nothing tabular here')).toEqual([]);
  });
});
