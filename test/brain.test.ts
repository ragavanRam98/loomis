import { describe, it, expect } from 'vitest';
import { MechanicalBrain } from '../src/brain';

const ctx = { surface: 'Home', refinements: [] };

describe('MechanicalBrain (default brain heuristic)', () => {
  const b = new MechanicalBrain();

  it('maps a plain change request to a directed refine', async () => {
    const d = await b.decide({ kind: 'change', screenId: 'home', text: 'make the header lighter' }, ctx);
    expect(d.actions).toEqual([{ verb: 'refine', screenId: 'home', feedback: 'make the header lighter' }]);
    expect(d.reasoning).toContain('directed edit');
  });

  it('routes a "generate one more screen" request to ADD (additive, not a replace)', async () => {
    const d = await b.decide(
      { kind: 'change', screenId: 'profile', text: 'generate one more screen to show the light mode of the profile' },
      { surface: 'Profile', refinements: [] },
    );
    expect(d.actions).toEqual([{ verb: 'add', screenId: 'profile', feedback: 'generate one more screen to show the light mode of the profile' }]);
    expect(d.reasoning).toMatch(/new screen/i);
  });

  it('routes "add a new screen" to ADD', async () => {
    const d = await b.decide({ kind: 'change', screenId: 'home', text: 'add a new screen for onboarding' }, ctx);
    expect(d.actions[0]).toMatchObject({ verb: 'add', screenId: 'home' });
  });

  it('keeps "make the screen lighter" a REFINE (a screen noun alone is not a create request)', async () => {
    const d = await b.decide({ kind: 'change', screenId: 'home', text: 'make the home screen lighter' }, ctx);
    expect(d.actions[0]).toMatchObject({ verb: 'refine', screenId: 'home' });
  });

  it('maps "options"/"explore" language to a suggest', async () => {
    const d = await b.decide({ kind: 'change', screenId: 'home', text: 'show me a few options' }, ctx);
    expect(d.actions[0]).toMatchObject({ verb: 'suggest', screenId: 'home', count: 3 });
  });

  it('maps "re-roll" to regenerate', async () => {
    const d = await b.decide({ kind: 'change', screenId: 'home', text: 're-roll this please' }, ctx);
    expect(d.actions[0]).toMatchObject({ verb: 'regenerate', screenId: 'home' });
  });

  it('does nothing for empty text', async () => {
    const d = await b.decide({ kind: 'change', screenId: 'home', text: '   ' }, ctx);
    expect(d.actions).toEqual([]);
  });
});
