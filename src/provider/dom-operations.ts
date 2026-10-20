// Stitch's edit agent can edit a screen in place: its answer to edit_screens then names no new screen and
// carries `project.file_update` session events, each a list of DOM operations for one screen, which the
// client applies to that screen's HTML. Stitch's own page applies them; through the API, the screen Stitch
// stores keeps its old HTML. Applying them here gives the edit the agent made.

import * as cheerio from 'cheerio';

export interface DomOperation {
  action: string;
  selector?: string | null;
  attr_name?: string | null;
  attr_value?: string | null;
  class_name?: string | null;
  content?: string | null;
  /** The element as Stitch saw it, which tells it apart when the selector matches several. */
  verified_html_context?: string | null;
}

/** The DOM operations an edit's answer gives one screen, in the order they come. */
export function domOperationsFor(answer: unknown, screenId: string): DomOperation[] {
  const out: DomOperation[] = [];
  const components = (answer as { outputComponents?: unknown[] } | null)?.outputComponents ?? [];
  for (const c of components) {
    const event = (c as { sessionEvent?: { eventType?: string; eventPayload?: Record<string, unknown> } }).sessionEvent;
    const payload = event?.eventPayload;
    if (event?.eventType !== 'project.file_update' || !payload || payload.screen_id !== screenId) continue;
    const ops = payload.dom_operations;
    if (Array.isArray(ops)) out.push(...(ops as DomOperation[]));
  }
  return out;
}

const squash = (s: string): string => s.replace(/\s+/g, ' ').trim();

/**
 * Apply DOM operations to a page, each to one element: the one Stitch quotes when the selector matches
 * several, or, when the selector matches none, the one element that opens like the quote. An operation
 * whose element can't be found, or whose action isn't known, is skipped and listed.
 */
export function applyDomOperations(
  html: string,
  ops: DomOperation[],
): { html: string; applied: number; skipped: string[] } {
  const $ = cheerio.load(html);
  const skipped: string[] = [];
  let applied = 0;
  for (const op of ops) {
    let matches: ReturnType<typeof $>[] = [];
    try {
      matches = op.selector ? $(op.selector).toArray().map((el) => $(el)) : [];
    } catch {
      matches = []; // a selector cheerio can't parse
    }
    const seen = op.verified_html_context ? squash(op.verified_html_context) : '';
    if (matches.length === 0 && seen) {
      // The selector can be wrong while the quoted element is right: take the one element that opens like it.
      const opening = seen.match(/^<[^>]*>/)?.[0] ?? '';
      const alike = opening ? $('body *').toArray().map((el) => $(el)).filter((e) => squash($.html(e)).startsWith(opening)) : [];
      if (alike.length === 1) matches = alike;
    }
    if (matches.length === 0) {
      skipped.push(`${op.action} ${op.selector ?? ''}: no element`);
      continue;
    }
    // With several matches, act on the one Stitch saw: the one its quoted HTML starts like.
    let target = matches[0]!;
    if (matches.length > 1 && seen) {
      const opening = seen.match(/^<[^>]*>/)?.[0] ?? seen;
      target = matches.find((m) => squash($.html(m)) === seen) ?? matches.find((m) => squash($.html(m)).startsWith(opening)) ?? target;
    }
    switch (op.action) {
      case 'set_attribute':
        if (!op.attr_name) { skipped.push(`${op.action} ${op.selector}: no attribute`); continue; }
        target.attr(op.attr_name, op.attr_value ?? '');
        break;
      case 'remove_attribute':
        if (!op.attr_name) { skipped.push(`${op.action} ${op.selector}: no attribute`); continue; }
        target.removeAttr(op.attr_name);
        break;
      case 'add_class':
        target.addClass(op.class_name ?? '');
        break;
      case 'remove_class':
        target.removeClass(op.class_name ?? '');
        break;
      case 'remove_element':
        target.remove();
        break;
      case 'replace_element':
        target.replaceWith(op.content ?? '');
        break;
      case 'append_child':
        target.append(op.content ?? '');
        break;
      case 'prepend_child':
        target.prepend(op.content ?? '');
        break;
      case 'insert_before':
        target.before(op.content ?? '');
        break;
      case 'insert_after':
        target.after(op.content ?? '');
        break;
      case 'set_inner_html':
      case 'replace_content':
        target.html(op.content ?? '');
        break;
      case 'set_text':
      case 'set_text_content':
        target.text(op.content ?? '');
        break;
      default:
        skipped.push(`${op.action} ${op.selector ?? ''}: unknown action`);
        continue;
    }
    applied += 1;
  }
  return { html: applied > 0 ? $.html() : html, applied, skipped };
}
