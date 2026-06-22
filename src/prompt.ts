// PROMPT CONTRACT assembly (MVP "basic"): turn a surface's BMAD spec slices into one
// well-structured generation prompt. Quote microcopy verbatim; omit empty sections;
// always emit OUT OF SCOPE and the data-nav hook instruction (verified to survive generation).

export interface PromptInput {
  surface: string;
  /** One-sentence intent (from the story). */
  purpose?: string;
  /** Ordered layout regions (from the EXPERIENCE.md IA entry). */
  regions?: string[];
  /** Verbatim on-screen copy: label -> exact string. */
  microcopy?: Record<string, string>;
  /** Visible states that change what's on screen (empty/loading/error). */
  states?: string[];
  /** Explicit navigation links to render, each keeping its data-nav hook. */
  navTargets?: Array<{ label: string; target: string }>;
  /** Design adjustments folded back from live `refine` edits (reconciled into the spec). */
  refinements?: string[];
  /** Pinned design-system asset id (reference only; tokens already loaded). */
  designSystemId?: string;
}

export function assemblePrompt(input: PromptInput): string {
  const out: string[] = [];
  out.push(`SCREEN: ${input.surface}`);
  if (input.designSystemId) {
    out.push(`DESIGN SYSTEM: ${input.designSystemId} (reference only; tokens already loaded)`);
  }
  out.push('');

  if (input.purpose && input.purpose.trim()) {
    out.push('PURPOSE');
    out.push(`  ${input.purpose.trim()}`);
    out.push('');
  }

  if (input.regions && input.regions.length > 0) {
    out.push('LAYOUT (top to bottom)');
    for (const region of input.regions) out.push(`  - ${region}`);
    out.push('');
  }

  if (input.microcopy && Object.keys(input.microcopy).length > 0) {
    out.push('CONTENT & MICROCOPY (verbatim)');
    for (const [element, text] of Object.entries(input.microcopy)) {
      out.push(`  - ${element}: "${text}"`);
    }
    out.push('');
  }

  if (input.states && input.states.length > 0) {
    out.push('STATES');
    for (const state of input.states) out.push(`  - ${state}`);
    out.push('');
  }

  if (input.navTargets && input.navTargets.length > 0) {
    out.push('NAVIGATION (render each as a link; keep the data-nav attribute exactly)');
    for (const t of input.navTargets) {
      out.push(`  - ${t.label}: <a data-nav="${t.target}" href="#">${t.label}</a>`);
    }
    out.push('');
  }

  if (input.refinements && input.refinements.length > 0) {
    out.push('REFINEMENTS (apply these design adjustments)');
    for (const r of input.refinements) out.push(`  - ${r}`);
    out.push('');
  }

  out.push('OUT OF SCOPE');
  out.push('  - No runtime/animation/data-fetch behavior.');
  out.push('');
  out.push(
    'NAV: every navigation/link element MUST keep a data-nav="<target-screen-id>" attribute and href="#" ' +
      '(this is how the screens get wired together - do not omit it).',
  );

  return out.join('\n');
}
