// Page-graph derivation (FR-8, NFR-3): turn EXPERIENCE.md IA "Reached from" relationships
// into a directed graph {entry, edges, unresolved}, resolved against the screens that
// actually exist in the manifest. Derived ONLY from the IA - never reverse-engineered from
// generated HTML - and deterministic (stable ordering).

import { slugify } from './slug';
import { parseIaTable, parseSurfaceSpec, type IaRow } from './experience';
import { readManifest, writeManifest } from './manifest';
import { appendLog } from './log';
import type { Clock } from './log';
import type { Edge, Manifest } from './types';

const ENTRY_RE = /app open|launch|cold start|on open|app start|^open$/i;

/** Find the longest IA surface name that appears in a "reached from" token. */
function resolveSurfaceToken(token: string, rows: IaRow[]): string | undefined {
  const t = token.toLowerCase();
  let best: string | undefined;
  let bestLen = 0;
  for (const r of rows) {
    const name = r.surface.toLowerCase();
    if (name.length > 0 && t.includes(name) && name.length > bestLen) {
      best = slugify(r.surface);
      bestLen = name.length;
    }
  }
  return best;
}

export interface NavGraph {
  entry: string[];
  edges: Edge[];
  unresolved: string[];
}

export function deriveNavGraph(experienceMd: string, knownScreenIds: string[] = []): NavGraph {
  const rows = parseIaTable(experienceMd);
  const known = new Set(knownScreenIds);
  const useKnown = known.size > 0;

  const entry = new Set<string>();
  const byKey = new Map<string, Edge>();
  const edges: Edge[] = [];
  const unresolved = new Set<string>();
  // The IA's "Reached from" edges: the drill-down tree, the only edges a way back is guessed for.
  const reachedFrom: Edge[] = [];
  const addEdge = (edge: Edge): Edge => {
    byKey.set(`${edge.from}->${edge.to}`, edge);
    edges.push(edge);
    return edge;
  };

  for (const r of rows) {
    const targetId = slugify(r.surface);
    const tokens = r.reachedFrom
      .split(/[\/,;]| or /i)
      .map((t) => t.trim())
      .filter(Boolean);

    if (tokens.length === 0) {
      unresolved.add(`(none) -> ${r.surface}`);
      continue;
    }

    for (const tok of tokens) {
      if (ENTRY_RE.test(tok)) {
        entry.add(targetId);
        continue;
      }
      const sourceId = resolveSurfaceToken(tok, rows);
      if (!sourceId) {
        // behavioral / keyboard / global nav we can't pin to a static link
        unresolved.add(`${tok} -> ${r.surface}`);
        continue;
      }
      if (useKnown && !known.has(targetId)) {
        unresolved.add(`${sourceId} -> ${targetId} (no target screen)`);
        continue;
      }
      if (useKnown && !known.has(sourceId)) {
        unresolved.add(`${sourceId} -> ${targetId} (no source screen)`);
        continue;
      }
      if (!byKey.has(`${sourceId}->${targetId}`)) {
        reachedFrom.push(addEdge({ from: sourceId, to: targetId }));
      }
    }
  }

  // Per-surface Nav declarations (sidebars, CTAs, drill-downs) become edges too - the
  // page-graph reflects ALL declared navigation, not only the IA "Reached from" tree.
  // Each edge keeps the label its Nav line gives the link (`- See the requests -> Requests`),
  // the first one as its label and every one in `labels` when several lines link the same two
  // screens, so `wire` can find each element the spec names even when the provider drops its hook.
  const declaresNav = new Set<string>();
  for (const r of rows) {
    const fromId = slugify(r.surface);
    if (useKnown && !known.has(fromId)) continue;
    const navTargets = parseSurfaceSpec(experienceMd, r.surface).navTargets;
    if (navTargets.length > 0) declaresNav.add(fromId);
    for (const nt of navTargets) {
      const toId = nt.target;
      if (!toId || toId === fromId) continue;
      if (useKnown && !known.has(toId)) {
        unresolved.add(`${fromId} -> ${toId} (nav target, no screen)`);
        continue;
      }
      const existing = byKey.get(`${fromId}->${toId}`);
      if (existing) {
        if (!existing.label) existing.label = nt.label;
        else if (existing.label !== nt.label && !existing.labels?.includes(nt.label)) {
          // Several Nav lines name the same link (a back link and a submit button): keep them all.
          existing.labels = [...(existing.labels ?? [existing.label]), nt.label];
        }
        continue;
      }
      addEdge({ from: fromId, to: toId, label: nt.label });
    }
  }

  // Back edges: a non-entry target can navigate back to where it was reached from, so the
  // back affordance becomes tracked (and wireable) instead of an invisible blind spot. Only
  // the IA's "Reached from" edges get one: a Nav line is a one-way link (a top bar's Profile
  // on every page doesn't make Profile link back to every page). And a surface whose Nav
  // list declares its links gets none guessed on top of them.
  for (const e of reachedFrom) {
    if (entry.has(e.to) || declaresNav.has(e.to)) continue;
    if (!byKey.has(`${e.to}->${e.from}`)) addEdge({ from: e.to, to: e.from });
  }

  edges.sort((a, b) => `${a.from}->${a.to}`.localeCompare(`${b.from}->${b.to}`));
  return { entry: [...entry].sort(), edges, unresolved: [...unresolved].sort() };
}

export function writeNavGraph(runFolder: string, experienceMd: string, clock?: Clock): Manifest {
  const manifest = readManifest(runFolder);
  const graph = deriveNavGraph(
    experienceMd,
    manifest.screens.map((s) => s.screenId),
  );
  manifest.entry = graph.entry;
  manifest.edges = graph.edges;
  manifest.unresolved = graph.unresolved;
  writeManifest(runFolder, manifest);
  appendLog(
    runFolder,
    { event: 'nav-graph', detail: { edges: graph.edges.length, unresolved: graph.unresolved.length } },
    clock,
  );
  return manifest;
}
