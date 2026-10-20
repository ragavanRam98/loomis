// Wiring (FR-9, FR-12, NFR-3): inject relative hrefs into the data-nav hooks each screen
// carries (`<a data-nav="screenId" href="#">`), per the manifest. A target that is `done`
// becomes a live local link; anything else is left as a visible dead-stub. Pure
// (manifest, html) -> html - no network, idempotent, no-op on hook-free HTML.

import * as cheerio from 'cheerio';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { readManifest } from './manifest';
import { appendLog, progress } from './log';
import type { Clock } from './log';
import type { Manifest, Edge } from './types';

const BACK_ICONS = ['arrow_back', 'arrow_back_ios', 'chevron_left', 'chevron', 'west', 'arrow_left', 'undo', 'back'];
// "Open the detail" cues a data-card carries when its visible text is data, not the target's name.
const FORWARD_ICONS = ['arrow_forward', 'arrow_forward_ios', 'chevron_right', 'navigate_next', 'keyboard_arrow_right', 'east', 'arrow_right_alt'];
// Don't wrap/replace table-structural tags - it would break the table.
const STRUCTURAL = new Set(['tr', 'td', 'th', 'thead', 'tbody', 'tfoot', 'table', 'col', 'colgroup']);

/** Text as matching sees it: lower case, typographic quotes and ellipses as ASCII, whitespace collapsed. */
function matchText(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‘’‛′]/g, "'")
    .replace(/[“”″]/g, '"')
    .replace(/…/g, '...')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Human cues meaning "go to <target>", from the target's surface name + CTA verbs (NOT the slug only). */
function forwardMatchTerms(surface: string, slug: string): string[] {
  const s = surface.toLowerCase().trim();
  const first = s.split(/\s+/)[0] ?? s;
  return [
    s,
    slug.toLowerCase(),
    `view ${first}`,
    `see ${first}`,
    `open ${first}`,
    `${first} details`,
    `view full ${first}`,
    `full ${first}`,
    'view report',
    'view details',
    'see details',
    'view more',
    'see more',
    'view full report',
  ].filter((t) => t.length >= 3);
}

/** When the provider omits data-nav hooks, wire the page-graph onto the best matching element. */
function fallbackWire($: cheerio.CheerioAPI, manifest: Manifest, screenId: string): number {
  const done = new Set(manifest.screens.filter((s) => s.status === 'done').map((s) => s.screenId));
  const entry = new Set(manifest.entry ?? []);
  const allCandidates = $('a, button, [role="button"], [data-icon], [class*="cursor-pointer"]').toArray();
  type El = (typeof allCandidates)[number];
  const tagOf = (el: El): string => String($(el).prop('tagName') ?? '').toLowerCase();
  const candidates = allCandidates.filter((el) => !STRUCTURAL.has(tagOf(el)));
  let wired = 0;

  /** Point an element at a target: an anchor gets the href, anything else becomes an anchor around its content. */
  const link = (el: El, target: string): void => {
    const $m = $(el);
    if (tagOf(el) === 'a') {
      // Already an anchor (often href="#") -> just point it at the target.
      $m.attr('href', `${target}.html`).attr('data-nav', target).attr('data-nav-state', 'live');
    } else {
      const cls = $m.attr('class') ?? '';
      const inner = $m.html() ?? $m.text();
      $m.replaceWith(
        `<a class="${cls}" href="${target}.html" data-nav="${target}" data-nav-state="live" role="button" style="text-decoration:none">${inner}</a>`,
      );
    }
  };

  for (const edge of manifest.edges.filter((e) => e.from === screenId)) {
    if (!done.has(edge.to)) continue;
    // The labels the spec gives this link (`- See the requests -> Requests queue`) name the
    // elements outright, so they match first, and for a link into an entry screen (Sign out)
    // they beat the back-arrow guess.
    const labels = (edge.labels ?? (edge.label ? [edge.label] : [])).map(matchText).filter((l) => l.length > 0);
    // An edge some element already links (often a data-nav hook) needs no guessing. But each
    // element the spec names for it gets linked too, when it isn't a live link already: a
    // provider can drop the hook from a submit button while a back link keeps the edge live.
    const linked = $(`a[href="${edge.to}.html"]`).toArray();
    if (linked.length > 0) {
      for (const label of labels) {
        const live = $(`a[href="${edge.to}.html"]`).toArray();
        if (live.some((el) => matchText($(el).text()).includes(label))) continue;
        const named = candidates.filter((el) => {
          if ($(el).closest('html').length === 0) return false; // replaced earlier in this pass
          const href = $(el).attr('href');
          return !(href && /\.html$/.test(href)) && matchText($(el).text()).includes(label);
        });
        const innermost = named.filter((el) => !named.some((o) => o !== el && $(o).parents().toArray().includes(el)));
        const best = innermost.find((el) => matchText($(el).text()) === label) ?? innermost[0];
        if (best) {
          link(best, edge.to);
          wired += 1;
        }
      }
      continue;
    }
    const isBack = entry.has(edge.to);
    const targetSurface =
      manifest.screens.find((s) => s.screenId === edge.to)?.surface ?? edge.to.replace(/-/g, ' ');
    const terms = forwardMatchTerms(targetSurface, edge.to);

    // Rank matches: prefer a real link/button with a focused label over a generic container.
    const matches: Array<{ el: El; score: number }> = [];
    for (const el of candidates) {
      const $el = $(el);
      const tag = tagOf(el);
      const icon = ($el.attr('data-icon') ?? '').toLowerCase();
      const text = matchText($el.text());
      const hay = `${icon} ${text}`;
      const labelHit = labels.some((l) => text.includes(l));
      const hit =
        labelHit ||
        (isBack ? BACK_ICONS.some((b) => hay.includes(b)) : icon === edge.to || terms.some((t) => hay.includes(t)));
      if (!hit) continue;
      let score = 0;
      if (labelHit) score += labels.includes(text) ? 6 : 4;
      if (tag === 'a' || tag === 'button') score += 3;
      if (text.length > 0 && text.length <= 40) score += 2;
      if (isBack && BACK_ICONS.some((b) => icon.includes(b))) score += 2;
      matches.push({ el, score });
    }
    if (matches.length === 0) continue;
    matches.sort((a, b) => b.score - a.score);
    link(matches[0]!.el, edge.to);
    wired += 1;
  }
  wired += drillDownWire($, manifest, screenId);
  return wired;
}

/**
 * Data-card drill-downs: a list row/card whose visible text is DATA (a task title, a project name)
 * can't match the target by text - but a forward chevron ("open detail") gives it away. Applied
 * ONLY when exactly one forward edge from this screen is still unwired, so we never guess between
 * multiple drill targets; ambiguous screens stay honestly unconnected.
 */
function drillDownWire($: cheerio.CheerioAPI, manifest: Manifest, screenId: string): number {
  const done = new Set(manifest.screens.filter((s) => s.status === 'done').map((s) => s.screenId));
  const entry = new Set(manifest.entry ?? []);
  const unwired = manifest.edges.filter(
    (e) => e.from === screenId && done.has(e.to) && !entry.has(e.to) && $(`a[href="${e.to}.html"]`).length === 0,
  );
  if (unwired.length !== 1) return 0; // 0 or 2+ -> don't guess
  const target = unwired[0]!.to;

  const all = $('a, button, [role="button"], li, [class*="cursor-pointer"], [class*="card"], [class*="row"]').toArray();
  type El = (typeof all)[number];
  const tagOf = (el: El): string => String($(el).prop('tagName') ?? '').toLowerCase();
  const hasChevron = (el: El): boolean => {
    const $el = $(el);
    let hay = ($el.attr('data-icon') ?? '').toLowerCase();
    $el.find('[data-icon]').each((_, d) => {
      hay += ' ' + ($(d).attr('data-icon') ?? '').toLowerCase();
    });
    hay += ' ' + $el.find('.material-symbols-outlined, .material-icons').text().toLowerCase();
    return FORWARD_ICONS.some((c) => hay.includes(c));
  };
  const notLive = (el: El): boolean => {
    const h = $(el).attr('href');
    return !(h && /\.html$/.test(h));
  };

  const cand = all.filter((el) => !STRUCTURAL.has(tagOf(el)) && notLive(el) && hasChevron(el));
  // Keep only innermost clickables, so wrapping one never detaches another pending one.
  const inner = cand.filter((el) => !cand.some((o) => o !== el && $(o).parents().toArray().includes(el)));

  let wired = 0;
  for (const el of inner) {
    const $el = $(el);
    if (tagOf(el) === 'a') {
      $el.attr('href', `${target}.html`).attr('data-nav', target).attr('data-nav-state', 'live');
    } else {
      const cls = $el.attr('class') ?? '';
      const innerHtml = $el.html() ?? $el.text();
      $el.replaceWith(
        `<a class="${cls}" href="${target}.html" data-nav="${target}" data-nav-state="live" role="button" style="text-decoration:none">${innerHtml}</a>`,
      );
    }
    wired += 1;
  }
  return wired;
}

export function wireHtml(html: string, manifest: Manifest, screenId?: string): string {
  const hasHooks = /data-nav/i.test(html);
  const hasEdges = !!(screenId && manifest.edges.some((e) => e.from === screenId));
  // Nothing to wire -> return the input untouched (no-op fidelity).
  if (!hasHooks && !hasEdges) return html;

  const done = new Set(
    manifest.screens.filter((s) => s.status === 'done').map((s) => s.screenId),
  );

  const $ = cheerio.load(html);
  let changed = 0;
  $('a[data-nav]').each((_, el) => {
    changed += 1;
    const target = $(el).attr('data-nav');
    if (target && done.has(target)) {
      $(el).attr('href', `${target}.html`);
      $(el).attr('data-nav-state', 'live');
    } else {
      $(el).attr('href', '#');
      $(el).attr('data-nav-state', 'dead');
    }
  });

  // Complement the hook pass: wire any page-graph edge the hooks didn't cover.
  // Providers commonly emit only PARTIAL data-nav hooks across a dense, multi-link screen.
  if (screenId) {
    changed += fallbackWire($, manifest, screenId);
  }

  if (changed === 0) return html; // nothing actually wired -> original (fidelity)
  return $.html();
}

export function wireRunFolder(runFolder: string, clock?: Clock): { wired: number; unwired: Edge[] } {
  const manifest = readManifest(runFolder);
  let wired = 0;
  for (const s of manifest.screens) {
    if (s.status !== 'done' || !s.htmlPath) continue;
    const path = join(runFolder, s.htmlPath);
    if (!existsSync(path)) continue;
    const html = readFileSync(path, 'utf8');
    const out = wireHtml(html, manifest, s.screenId);
    if (out !== html) writeFileSync(path, out, 'utf8');
    wired += 1;
  }

  // Surface IA edges that did NOT become a live link - never fail to connect silently.
  const done = new Set(manifest.screens.filter((s) => s.status === 'done').map((s) => s.screenId));
  const unwired: Edge[] = [];
  for (const edge of manifest.edges) {
    if (!done.has(edge.from) || !done.has(edge.to)) continue;
    const src = manifest.screens.find((s) => s.screenId === edge.from);
    if (!src?.htmlPath) continue;
    const html = readFileSync(join(runFolder, src.htmlPath), 'utf8');
    if (!html.includes(`href="${edge.to}.html"`)) unwired.push(edge);
  }

  appendLog(runFolder, { event: 'wire', detail: { wired, unwired: unwired.length } }, clock);
  progress(`Wired ${wired} screen(s); ${unwired.length} declared edge(s) still unconnected.`);
  return { wired, unwired };
}
