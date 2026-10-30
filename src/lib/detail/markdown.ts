// Safe markdown subset for issue descriptions and comments. Parses to a token tree that React renders as elements:
// no raw HTML ever reaches the DOM (no dangerouslySetInnerHTML), and links are allow-listed by scheme.
export type Inline =
  | { t: 'text'; v: string }
  | { t: 'code'; v: string }
  | { t: 'strong' | 'em' | 'del'; c: Inline[] }
  | { t: 'link'; href: string; c: Inline[] }
  | { t: 'mention'; user: string; raw?: string };
export type Block =
  | { t: 'p'; c: Inline[] }
  | { t: 'h'; level: 1 | 2 | 3; c: Inline[] }
  | { t: 'ul' | 'ol'; items: Inline[][] }
  | { t: 'task'; items: { done: boolean; c: Inline[] }[] }
  | { t: 'quote'; c: Inline[] }
  | { t: 'pre'; v: string }
  | { t: 'hr' };

const SAFE_SCHEME = /^(https?:|mailto:)/i;
/** Returns a safe href or null. Relative paths (/w/...) and #anchors are allowed; javascript:, data:, vbscript: etc. are not. */
export function safeHref(raw: string): string | null {
  // eslint-disable-next-line no-control-regex -- stripping control chars is the point (java\tscript: bypass)
  const s = raw.trim().replace(/[\u0000-\u001f\u007f\s]+/g, '');
  if (!s) return null;
  if (s.startsWith('//')) return null; // protocol-relative: treat as external host spoofing
  if (s.startsWith('/') || s.startsWith('#')) return s;
  if (SAFE_SCHEME.test(s)) {
    try { new URL(s); return s; } catch { return null; }
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(s)) return null; // any other scheme
  return null;
}

export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  let buf = '';
  const flush = () => { if (buf) { out.push({ t: 'text', v: buf }); buf = ''; } };
  let i = 0;
  while (i < src.length) {
    const rest = src.slice(i);
    let m: RegExpMatchArray | null;
    if (rest[0] === '\\' && rest.length > 1) { buf += rest[1]; i += 2; continue; }
    if ((m = rest.match(/^`([^`]+)`/))) { flush(); out.push({ t: 'code', v: m[1] ?? '' }); i += m[0].length; continue; }
    if ((m = rest.match(/^@\[([^\]]{1,64})\]\(([0-9a-f-]{36})\)/i))) { flush(); out.push({ t: 'mention', user: m[1] ?? '', raw: m[0] }); i += m[0].length; continue; }
    if ((m = rest.match(/^\[([^\]]+)\]\(((?:[^()\s]|\([^()\s]*\))+)\)/))) {
      flush();
      const href = safeHref(m[2] ?? '');
      const c = parseInline(m[1] ?? '');
      if (href) out.push({ t: 'link', href, c }); else out.push(...c);
      i += m[0].length; continue;
    }
    if ((m = rest.match(/^(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])/))) { flush(); const href = safeHref(m[1] ?? ''); if (href) out.push({ t: 'link', href, c: [{ t: 'text', v: m[1] ?? '' }] }); else buf += m[1]; i += m[0].length; continue; }
    if ((m = rest.match(/^\*\*(.+?)\*\*/))) { flush(); out.push({ t: 'strong', c: parseInline(m[1] ?? '') }); i += m[0].length; continue; }
    if ((m = rest.match(/^~~(.+?)~~/))) { flush(); out.push({ t: 'del', c: parseInline(m[1] ?? '') }); i += m[0].length; continue; }
    if ((m = rest.match(/^[*_]([^*_\s][^*_]*?)[*_]/)) && (i === 0 || !/\w/.test(src[i - 1] ?? ''))) { flush(); out.push({ t: 'em', c: parseInline(m[1] ?? '') }); i += m[0].length; continue; }
    if ((m = rest.match(/^@([a-z0-9][a-z0-9._-]{0,38})/i)) && (i === 0 || /\s/.test(src[i - 1] ?? ''))) { flush(); out.push({ t: 'mention', user: m[1] ?? '' }); i += m[0].length; continue; }
    buf += rest[0]; i += 1;
  }
  flush();
  return out;
}

export function parseMarkdown(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const out: Block[] = [];
  let para: string[] = [];
  const endPara = () => { if (para.length) { out.push({ t: 'p', c: parseInline(para.join(' ')) }); para = []; } };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    let m: RegExpMatchArray | null;
    const fenceOpen = line.match(/^(`{3,})/);
    if (fenceOpen) {
      const flen = fenceOpen[1]?.length ?? 3;
      endPara();
      const body: string[] = [];
      i++;
      while (i < lines.length && !(((lines[i] ?? '').match(/^(`+)\s*$/)?.[1] ?? '').length >= flen)) body.push(lines[i++] ?? '');
      out.push({ t: 'pre', v: body.join('\n') });
      continue;
    }
    if (!line.trim()) { endPara(); continue; }
    if ((m = line.match(/^(#{1,3})\s+(.*)$/))) { endPara(); out.push({ t: 'h', level: (m[1]?.length ?? 1) as 1 | 2 | 3, c: parseInline(m[2] ?? '') }); continue; }
    if (/^(-{3,}|\*{3,})\s*$/.test(line)) { endPara(); out.push({ t: 'hr' }); continue; }
    if (/^>\s?/.test(line)) { endPara(); const q: string[] = []; while (i < lines.length && /^>\s?/.test(lines[i] ?? '')) q.push((lines[i++] ?? '').replace(/^>\s?/, '')); i--; out.push({ t: 'quote', c: parseInline(q.join(' ')) }); continue; }
    if (/^[-*]\s\[[ xX]\]\s/.test(line)) {
      endPara(); const items: { done: boolean; c: Inline[] }[] = [];
      while (i < lines.length && (m = (lines[i] ?? '').match(/^[-*]\s\[([ xX])\]\s(.*)$/))) { items.push({ done: m[1] !== ' ', c: parseInline(m[2] ?? '') }); i++; }
      i--; out.push({ t: 'task', items }); continue;
    }
    if (/^([-*]|\d+\.)\s/.test(line)) {
      endPara(); const ordered = /^\d+\./.test(line); const items: Inline[][] = [];
      const re = ordered ? /^\d+\.\s(.*)$/ : /^[-*]\s(.*)$/;
      while (i < lines.length && (m = (lines[i] ?? '').match(re))) { items.push(parseInline(m[1] ?? '')); i++; }
      i--; out.push({ t: ordered ? 'ol' : 'ul', items }); continue;
    }
    para.push(line.trim());
  }
  endPara();
  return out;
}
