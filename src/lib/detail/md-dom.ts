// DOM <-> block tree for the WYSIWYG description editor. Rendering builds elements with createElement/textContent only
// (no innerHTML), so stored markdown can never inject markup. Reading tolerates what contentEditable and execCommand produce.
import { parseMarkdown, safeHref, type Block, type Inline } from './markdown';

const H_TAG = ['h1', 'h2', 'h3'] as const;

function inlineNodes(doc: Document, nodes: Inline[]): Node[] {
  return nodes.map((n): Node => {
    switch (n.t) {
      case 'text': return doc.createTextNode(n.v);
      case 'code': { const e = doc.createElement('code'); e.textContent = n.v; return e; }
      case 'strong': case 'em': case 'del': { const e = doc.createElement(n.t === 'strong' ? 'strong' : n.t === 'em' ? 'em' : 's'); e.append(...inlineNodes(doc, n.c)); return e; }
      case 'mention': { const e = doc.createElement('span'); e.className = 'mention'; e.textContent = `@${n.user}`; if (n.raw) e.dataset.raw = n.raw; return e; }
      case 'link': { const e = doc.createElement('a'); e.setAttribute('href', n.href); e.append(...inlineNodes(doc, n.c)); return e; }
    }
  });
}
const el = (doc: Document, tag: string, kids: Node[] = []) => { const e = doc.createElement(tag); e.append(...kids); return e; };

export function blockNode(doc: Document, b: Block): HTMLElement {
  switch (b.t) {
    case 'p': return el(doc, 'p', inlineNodes(doc, b.c));
    case 'h': return el(doc, H_TAG[b.level - 1] ?? 'h3', inlineNodes(doc, b.c));
    case 'quote': return el(doc, 'blockquote', inlineNodes(doc, b.c));
    case 'ul': case 'ol': return el(doc, b.t, b.items.map((it) => el(doc, 'li', inlineNodes(doc, it))));
    case 'task': { const u = el(doc, 'ul', b.items.map((it) => { const li = el(doc, 'li', inlineNodes(doc, it.c)); li.dataset.done = it.done ? '1' : '0'; return li; })); u.dataset.tasks = '1'; return u; }
    case 'pre': { const c = doc.createElement('code'); c.textContent = b.v; return el(doc, 'pre', [c]); }
    case 'hr': { const h = doc.createElement('hr'); h.contentEditable = 'false'; return h; }
  }
}

export function renderMarkdown(root: HTMLElement, md: string): void {
  const doc = root.ownerDocument;
  root.replaceChildren(...parseMarkdown(md).map((b) => blockNode(doc, b)));
}

const text = (n: Node) => (n.textContent ?? '').replace(/\u00a0/g, ' ');
function readInline(n: Node, out: Inline[]): void {
  if (n.nodeType === 3) { const v = text(n); if (v) out.push({ t: 'text', v }); return; }
  if (n.nodeType !== 1) return;
  const e = n as HTMLElement, tag = e.tagName.toLowerCase();
  const kids = () => { const c: Inline[] = []; e.childNodes.forEach((k) => readInline(k, c)); return c; };
  if (tag === 'br') { out.push({ t: 'text', v: ' ' }); return; }
  if (tag === 'code') { out.push({ t: 'code', v: text(e) }); return; }
  if (tag === 'strong' || tag === 'b') { out.push({ t: 'strong', c: kids() }); return; }
  if (tag === 'em' || tag === 'i') { out.push({ t: 'em', c: kids() }); return; }
  if (tag === 's' || tag === 'strike' || tag === 'del') { out.push({ t: 'del', c: kids() }); return; }
  if (tag === 'a') { const href = safeHref(e.getAttribute('href') ?? ''); if (href) out.push({ t: 'link', href, c: kids() }); else out.push(...kids()); return; }
  if (e.classList.contains('mention')) { const raw = e.dataset.raw; out.push({ t: 'mention', user: text(e).replace(/^@/, ''), ...(raw ? { raw } : {}) }); return; }
  out.push(...kids());
}
const inl = (e: Node) => { const c: Inline[] = []; e.childNodes.forEach((k) => readInline(k, c)); return c; };
const BLOCK_TAGS = new Set(['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'blockquote', 'pre', 'hr', 'li']);

/** Reads the editor DOM back into blocks. Stray inline nodes at the top level become a paragraph; divs (Chrome's Enter) are paragraphs. */
export function readBlocks(root: HTMLElement): Block[] {
  const out: Block[] = [];
  let loose: Inline[] = [];
  const flush = () => { if (loose.length) { out.push({ t: 'p', c: loose }); loose = []; } };
  const walk = (parent: Node) => parent.childNodes.forEach((n) => {
    if (n.nodeType !== 1) { readInline(n, loose); return; }
    const e = n as HTMLElement, tag = e.tagName.toLowerCase();
    if (!BLOCK_TAGS.has(tag)) { readInline(n, loose); return; }
    flush();
    if (tag === 'p') out.push({ t: 'p', c: inl(e) });
    else if (tag === 'div') { if (Array.from(e.children).some((k) => BLOCK_TAGS.has(k.tagName.toLowerCase()))) walk(e); else out.push({ t: 'p', c: inl(e) }); }
    else if (/^h[1-6]$/.test(tag)) out.push({ t: 'h', level: Math.min(Number(tag[1]), 3) as 1 | 2 | 3, c: inl(e) });
    else if (tag === 'blockquote') out.push({ t: 'quote', c: inl(e) });
    else if (tag === 'pre') out.push({ t: 'pre', v: text(e).replace(/\n$/, '') });
    else if (tag === 'hr') out.push({ t: 'hr' });
    else if (tag === 'ul' || tag === 'ol') {
      const items = Array.from(e.querySelectorAll('li'));
      if (e.dataset.tasks) out.push({ t: 'task', items: items.map((li) => ({ done: li.dataset.done === '1', c: inl(li) })) });
      else out.push({ t: tag, items: items.map((li) => inl(li)) });
    }
  });
  walk(root);
  flush();
  return out;
}

/** The block (direct child of the editor root) holding a node. */
export function blockOf(root: HTMLElement, node: Node | null): HTMLElement | null {
  let n: Node | null = node;
  while (n && n.parentNode !== root) n = n.parentNode;
  return n && n.nodeType === 1 ? (n as HTMLElement) : null;
}
