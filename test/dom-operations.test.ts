import { describe, it, expect } from 'vitest';
import { applyDomOperations, domOperationsFor } from '../src/provider/dom-operations';

const PAGE = `<html><head><title>t</title></head><body>
<aside class="w-full md:w-56">nav</aside>
<h1>Download the data <span class="badge warn">Planned</span></h1>
<p><span class="code font-mono">ECA</span> <span class="code font-mono">ECA26-004782</span></p>
<header><span class="logo">TO</span><span class="tag">Admin</span></header>
</body></html>`;

describe('applyDomOperations (Stitch edits made in place)', () => {
  it('applies each kind of operation Stitch sends', () => {
    const { html, applied, skipped } = applyDomOperations(PAGE, [
      { action: 'set_attribute', selector: 'aside', attr_name: 'class', attr_value: 'w-full md:w-[240px]' },
      { action: 'remove_element', selector: 'h1 > span.badge' },
      { action: 'add_class', selector: '#missing, h1', class_name: 'tabular-nums' },
      { action: 'remove_class', selector: 'p > span.code', class_name: 'font-mono' },
      { action: 'replace_element', selector: 'header > span:nth-child(2)', content: '<span class="pill">Admin</span>' },
      { action: 'append_child', selector: 'head', content: '<style id="o">.x{color:#00479C}</style>' },
    ]);
    expect(applied).toBe(6);
    expect(skipped).toEqual([]);
    expect(html).toContain('<aside class="w-full md:w-[240px]">');
    expect(html).not.toContain('Planned');
    expect(html).toContain('<h1 class="tabular-nums">');
    // One operation, one element: without a quoted element to tell them apart, the first match.
    expect(html).toContain('<span class="code">ECA</span> <span class="code font-mono">ECA26-004782</span>');
    expect(html).toContain('<span class="pill">Admin</span>');
    expect(html).toContain('<style id="o">.x{color:#00479C}</style></head>');
  });

  it("acts on the element Stitch saw when the selector matches several, by the HTML it quotes", () => {
    const { html } = applyDomOperations(PAGE, [
      {
        action: 'add_class',
        selector: 'span.code',
        class_name: 'tabular-nums',
        verified_html_context: '<span class="code font-mono">ECA26-004782</span>',
      },
    ]);
    expect(html).toContain('<span class="code font-mono">ECA</span>');
    expect(html).toContain('<span class="code font-mono tabular-nums">ECA26-004782</span>');
  });

  it("replaces an element's content", () => {
    const { html } = applyDomOperations(PAGE, [{ action: 'replace_content', selector: 'aside', content: 'Runs every night.' }]);
    expect(html).toContain('<aside class="w-full md:w-56">Runs every night.</aside>');
  });

  it('finds the element Stitch quotes when its selector finds none, if only one element looks like it', () => {
    const quoted = '<span class="badge warn">';
    const { html, applied } = applyDomOperations(PAGE, [
      { action: 'remove_element', selector: 'h1 a ~ span', verified_html_context: quoted },
    ]);
    expect(applied).toBe(1);
    expect(html).not.toContain('Planned');
    const twice = PAGE.replace('</h1>', '</h1><span class="badge warn">Soon</span>');
    const r = applyDomOperations(twice, [{ action: 'remove_element', selector: 'h1 a ~ span', verified_html_context: quoted }]);
    expect(r.applied).toBe(0); // two look like it: no guess
  });

  it('skips, and lists, an operation it cannot place or does not know', () => {
    const r = applyDomOperations(PAGE, [
      { action: 'remove_element', selector: 'table.none' },
      { action: 'teleport', selector: 'aside' },
    ]);
    expect(r.applied).toBe(0);
    expect(r.skipped).toHaveLength(2);
    expect(r.html).toBe(PAGE);
  });
});

describe('domOperationsFor', () => {
  it("collects one screen's operations from an edit's answer, in order", () => {
    const answer = {
      outputComponents: [
        { text: 'done' },
        { sessionEvent: { eventType: 'project.file_update', eventPayload: { payload_type: 'DomOperationEvent', screen_id: 'a1', dom_operations: [{ action: 'add_class', selector: 'h1', class_name: 'x' }] } } },
        { sessionEvent: { eventType: 'project.file_update', eventPayload: { payload_type: 'DomOperationEvent', screen_id: 'b2', dom_operations: [{ action: 'remove_element', selector: 'p' }] } } },
        { sessionEvent: { eventType: 'project.file_update', eventPayload: { payload_type: 'DomOperationEvent', screen_id: 'a1', dom_operations: [{ action: 'remove_class', selector: 'h1', class_name: 'y' }] } } },
      ],
    };
    expect(domOperationsFor(answer, 'a1').map((o) => o.action)).toEqual(['add_class', 'remove_class']);
    expect(domOperationsFor(answer, 'zz')).toEqual([]);
  });
});
