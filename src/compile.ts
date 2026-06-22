// The EXPERIENCE.md -> prompt compiler (was the deferred fast-follow). Turns each surface's
// structured spec (purpose, layout, verbatim microcopy, states, nav) into a faithful
// generation prompt, the expected-content list (for omission detection), and its story link.

import { slugify } from './slug';
import { parseIaTable, parseSurfaceSpec } from './experience';
import { assemblePrompt } from './prompt';

export interface CompiledScreen {
  screenId: string;
  surface: string;
  prompt: string;
  expectedContent: string[];
  story?: string;
}

export function compileScreen(
  experienceMd: string,
  surface: string,
  designSystemId?: string,
): CompiledScreen {
  const spec = parseSurfaceSpec(experienceMd, surface);
  const prompt = assemblePrompt({
    surface,
    ...(spec.purpose ? { purpose: spec.purpose } : {}),
    regions: spec.regions,
    microcopy: spec.microcopy,
    states: spec.states,
    navTargets: spec.navTargets,
    ...(spec.refinements.length ? { refinements: spec.refinements } : {}),
    ...(designSystemId ? { designSystemId } : {}),
  });
  return {
    screenId: slugify(surface),
    surface,
    prompt,
    expectedContent: Object.values(spec.microcopy),
    ...(spec.story ? { story: spec.story } : {}),
  };
}

export function compileAll(experienceMd: string, designSystemId?: string): CompiledScreen[] {
  return parseIaTable(experienceMd).map((r) => compileScreen(experienceMd, r.surface, designSystemId));
}
