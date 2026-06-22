// Parse the EXPERIENCE.md Information Architecture table. The IA drives both surface
// enumeration (Story 2.1) and the page-graph (Story 2.2): each row's "Reached from"
// is a directed edge into that surface.

import { slugify } from './slug';

export interface IaRow {
  surface: string;
  reachedFrom: string;
  purpose?: string;
}

export function parseIaTable(experienceMd: string): IaRow[] {
  const lines = experienceMd.split('\n');
  const rows: IaRow[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const header = lines[i];
    // Find the IA table header: a pipe row mentioning Surface + Reached from.
    if (header && header.includes('|') && /surface/i.test(header) && /reach/i.test(header)) {
      // Data rows begin after the |---|---| separator line.
      for (let j = i + 2; j < lines.length; j += 1) {
        const row = lines[j];
        if (!row || !row.includes('|') || !row.trim()) break;
        const cells = row.split('|').map((c) => c.trim());
        const surface = cells[1] ?? '';
        const reachedFrom = cells[2] ?? '';
        const purpose = cells[3];
        if (!surface || /^-+$/.test(surface)) continue; // skip separators/blanks
        const r: IaRow = { surface, reachedFrom };
        if (purpose) r.purpose = purpose;
        rows.push(r);
      }
      break;
    }
  }

  return rows;
}

export interface SurfaceSpec {
  purpose?: string;
  regions: string[];
  microcopy: Record<string, string>;
  states: string[];
  navTargets: Array<{ label: string; target: string }>;
  /** Design adjustments folded back from live `refine` edits (the reconcile trail). */
  refinements: string[];
  story?: string;
}

/**
 * Parse a per-surface section of EXPERIENCE.md (## <Surface>) into a structured spec.
 * Recognises `Purpose:` / `Story:` lines and `Layout:` / `Microcopy:` / `States:` /
 * `Nav:` bullet blocks. Microcopy bullets are `- key: "value"`; nav bullets are
 * `- label -> Target Surface`.
 */
export function parseSurfaceSpec(experienceMd: string, surface: string): SurfaceSpec {
  const lines = experienceMd.split('\n');
  const spec: SurfaceSpec = { regions: [], microcopy: {}, states: [], navTargets: [], refinements: [] };

  const headingIdx = lines.findIndex(
    (l) => /^#{2,4}\s+/.test(l) && l.replace(/^#{2,4}\s+/, '').trim().toLowerCase() === surface.toLowerCase(),
  );
  if (headingIdx === -1) return spec;

  let section: 'layout' | 'microcopy' | 'states' | 'nav' | 'refinements' | null = null;
  for (let j = headingIdx + 1; j < lines.length; j += 1) {
    const raw = lines[j] ?? '';
    if (/^#{2,4}\s+/.test(raw)) break; // next heading ends this surface's section
    const t = raw.trim();
    if (!t) continue;

    const purpose = t.match(/^purpose:\s*(.+)$/i);
    if (purpose) {
      spec.purpose = (purpose[1] ?? '').trim();
      section = null;
      continue;
    }
    const story = t.match(/^story:\s*(.+)$/i);
    if (story) {
      spec.story = (story[1] ?? '').trim();
      section = null;
      continue;
    }
    if (/^layout:?$/i.test(t)) { section = 'layout'; continue; }
    if (/^microcopy:?$/i.test(t)) { section = 'microcopy'; continue; }
    if (/^states:?$/i.test(t)) { section = 'states'; continue; }
    if (/^nav(igation)?:?$/i.test(t)) { section = 'nav'; continue; }
    if (/^refinements:?$/i.test(t)) { section = 'refinements'; continue; }

    if (t.startsWith('-') || t.startsWith('*')) {
      const item = t.replace(/^[-*]\s+/, '').trim();
      if (section === 'layout') spec.regions.push(item);
      else if (section === 'refinements') spec.refinements.push(item);
      else if (section === 'states') spec.states.push(item);
      else if (section === 'microcopy') {
        const m = item.match(/^([^:]+):\s*"?(.*?)"?$/);
        if (m && m[1]) spec.microcopy[m[1].trim()] = (m[2] ?? '').trim();
      } else if (section === 'nav') {
        const m = item.match(/^(.+?)\s*(?:->|→)\s*(.+)$/);
        if (m && m[1] && m[2]) spec.navTargets.push({ label: m[1].trim(), target: slugify(m[2].trim()) });
      }
    }
  }

  return spec;
}
