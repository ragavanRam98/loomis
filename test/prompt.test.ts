import { describe, it, expect } from 'vitest';
import { assemblePrompt } from '../src/prompt';

describe('assemblePrompt (PROMPT CONTRACT, MVP basic)', () => {
  it('emits a contract-shaped prompt with verbatim microcopy and the data-nav instruction', () => {
    const p = assemblePrompt({
      surface: 'Today',
      purpose: 'See what is in motion right now',
      regions: ['Sidebar nav', 'Focus card', 'In-motion list'],
      microcopy: { header: '3 tasks in motion', empty: 'Nothing in motion. Pick something.' },
      states: ['empty: Nothing in motion. Pick something.'],
      designSystemId: 'assets/abc',
    });
    expect(p).toContain('SCREEN: Today');
    expect(p).toContain('DESIGN SYSTEM: assets/abc');
    expect(p).toContain('PURPOSE');
    expect(p).toContain('"3 tasks in motion"'); // verbatim, quoted
    expect(p).toContain('"Nothing in motion. Pick something."');
    expect(p).toContain('OUT OF SCOPE');
    expect(p).toContain('data-nav'); // wiring hook instruction always present
  });

  it('omits empty sections (absent != empty), but always emits OUT OF SCOPE + NAV', () => {
    const p = assemblePrompt({ surface: 'Bare' });
    expect(p).toContain('SCREEN: Bare');
    expect(p).not.toContain('PURPOSE');
    expect(p).not.toContain('CONTENT & MICROCOPY');
    expect(p).not.toContain('LAYOUT');
    expect(p).not.toContain('STATES');
    expect(p).toContain('OUT OF SCOPE');
    expect(p).toContain('data-nav');
  });
});
