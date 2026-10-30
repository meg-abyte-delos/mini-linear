// Block/inline tree -> markdown, the inverse of parseMarkdown for the safe subset. Used by the WYSIWYG description editor:
// the editor reads its DOM into this tree, and this file writes the markdown the API stores.
import { safeHref, type Block, type Inline } from './markdown';

const URL_RE = /https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"]/g;
const esc = (s: string) => s.replace(/[\\*_`[\]~]/g, (c) => `\\${c}`);
/** Escapes markdown syntax in plain text, but leaves bare URLs alone (the parser autolinks them). */
function escapeText(raw: string): string {
  const s = raw.replace(/\u00a0/g, ' ');
  let out = '', at = 0;
  for (const m of s.matchAll(URL_RE)) { out += esc(s.slice(at, m.index)) + m[0]; at = (m.index ?? 0) + m[0].length; }
  return out + esc(s.slice(at));
}
/** Moves edge whitespace outside the markers: `** x**` would not read back as emphasis. */
function wrap(inner: string, mark: string): string {
  const m = inner.match(/^(\s*)([\s\S]*?)(\s*)$/);
  if (!m || !m[2]) return inner;
  return `${m[1]}${mark}${m[2]}${mark}${m[3]}`;
}

export function inlineToMarkdown(nodes: Inline[]): string {
  return nodes.map((n) => {
    switch (n.t) {
      case 'text': return escapeText(n.v);
      case 'code': return n.v ? `\`${n.v.replace(/`/g, '')}\`` : '';
      case 'strong': return wrap(inlineToMarkdown(n.c), '**');
      case 'em': return wrap(inlineToMarkdown(n.c), '_');
      case 'del': return wrap(inlineToMarkdown(n.c), '~~');
      case 'mention': return n.raw ?? `@${n.user}`;
      case 'link': {
        const href = safeHref(n.href);
        if (href && /^https?:/i.test(href) && n.c.length === 1 && n.c[0]?.t === 'text' && n.c[0].v === href) return href; // autolink: keep it bare
        const text = inlineToMarkdown(n.c);
        return href ? `[${text || href}](${href.replace(/ /g, '%20')})` : text;
      }
    }
  }).join('');
}

// A paragraph whose text would read as another block (heading, list, quote, fence, rule) gets its first character escaped.
const BLOCK_START = /^(#{1,3}\s|[-*]\s|\d+\.\s|>|```|(-{3,}|\*{3,})\s*$)/;
const guard = (s: string) => (BLOCK_START.test(s) ? `\\${s}` : s);

export function blocksToMarkdown(blocks: Block[]): string {
  const out: string[] = [];
  for (const b of blocks) {
    switch (b.t) {
      case 'p': { const t = inlineToMarkdown(b.c).trim(); if (t) out.push(guard(t)); break; }
      case 'h': { const t = inlineToMarkdown(b.c).trim(); if (t) out.push(`${'#'.repeat(b.level)} ${t}`); break; }
      case 'quote': { const t = inlineToMarkdown(b.c).trim(); if (t) out.push(`> ${t}`); break; }
      case 'ul': { const l = b.items.map((it) => inlineToMarkdown(it).trim()).filter(Boolean).map((t) => `- ${t}`); if (l.length) out.push(l.join('\n')); break; }
      case 'ol': { const l = b.items.map((it) => inlineToMarkdown(it).trim()).filter(Boolean).map((t, k) => `${k + 1}. ${t}`); if (l.length) out.push(l.join('\n')); break; }
      case 'task': { const l = b.items.map((it) => ({ d: it.done, t: inlineToMarkdown(it.c).trim() })).filter((it) => it.t).map((it) => `- [${it.d ? 'x' : ' '}] ${it.t}`); if (l.length) out.push(l.join('\n')); break; }
      case 'pre': out.push('```\n' + b.v.replace(/\n+$/, '') + '\n```'); break;
      case 'hr': out.push('---'); break;
    }
  }
  return out.join('\n\n');
}
