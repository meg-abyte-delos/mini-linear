'use client';
// WYSIWYG description editor (no Write/Preview split). contentEditable surface over the safe markdown subset: the DOM is built
// from the parsed markdown with createElement only, edits are read back into blocks and written as markdown on blur.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Tooltip } from '@/components/ui';
import { parseMarkdown, safeHref } from '@/lib/detail/markdown';
import { blocksToMarkdown } from '@/lib/detail/md-serialize';
import { blockOf, blockNode, readBlocks, renderMarkdown } from '@/lib/detail/md-dom';

interface Props { value: string; onCommit: (md: string) => void; readOnly?: boolean; label?: string; placeholder?: string }

const ic = (d: string) => <svg width='16' height='16' viewBox='0 0 16 16' fill='none' stroke='currentColor' strokeWidth='1.4' strokeLinecap='round' strokeLinejoin='round' aria-hidden='true' focusable='false'><path d={d} /></svg>;
const ICON = {
  bold: ic('M4.5 2.5h4a2.2 2.2 0 0 1 0 4.5h-4zM4.5 7h4.5a2.3 2.3 0 0 1 0 4.5H4.5z'),
  italic: ic('M9.5 2.5h-3M9.5 13.5h-3M9 2.5l-2 11'),
  strike: ic('M2.5 8h11M10.5 4.5C10 3.4 9 2.8 7.8 2.8c-1.6 0-2.7.9-2.7 2.1 0 2.6 5.6 1.4 5.6 4.3 0 1.3-1.2 2.2-2.9 2.2-1.4 0-2.5-.6-3-1.8'),
  code: ic('M5.5 4 2 8l3.5 4M10.5 4 14 8l-3.5 4'),
  link: ic('M6.8 9.2a2.5 2.5 0 0 0 3.5 0l2.2-2.2a2.5 2.5 0 0 0-3.5-3.5l-.6.6M9.2 6.8a2.5 2.5 0 0 0-3.5 0L3.5 9a2.5 2.5 0 0 0 3.5 3.5l.6-.6'),
  heading: ic('M3.5 3v10M12.5 3v10M3.5 8h9'),
  ul: ic('M6 4h7.5M6 8h7.5M6 12h7.5M2.5 4h.01M2.5 8h.01M2.5 12h.01'),
  ol: ic('M6.5 4h7M6.5 8h7M6.5 12h7M2.5 3l1-.5V6M2.3 9.5c.6-.7 1.9-.4 1.6.5l-1.6 1.7H4'),
  task: ic('M2.5 3.5h4v4h-4zM3.3 5.5l.8.8 1.4-1.6M8.5 5.5h5M2.5 10.5h4v3h-4zM8.5 12h5'),
  quote: ic('M3 11V8.5c0-2 1-3.2 2.8-3.5M8.5 11V8.5c0-2 1-3.2 2.8-3.5M3 11h2.5V8.5H3M8.5 11H11V8.5H8.5'),
  pre: ic('M2.5 3.5h11v9h-11zM5.5 7l1.5 1.5L5.5 10M8.5 10h2'),
};

// Markdown shortcut typed at the start of an empty-ish line, followed by a space.
const SHORTCUTS: { re: RegExp; make: (m: RegExpMatchArray, d: Document) => HTMLElement }[] = [
  { re: /^(#{1,3})$/, make: (m, d) => d.createElement(`h${m[1]?.length ?? 1}`) },
  { re: /^[-*]$/, make: (_m, d) => { const u = d.createElement('ul'); u.append(d.createElement('li')); return u; } },
  { re: /^\d+\.$/, make: (_m, d) => { const u = d.createElement('ol'); u.append(d.createElement('li')); return u; } },
  { re: /^\[ ?\]$/, make: (_m, d) => { const u = d.createElement('ul'); u.dataset.tasks = '1'; const li = d.createElement('li'); li.dataset.done = '0'; u.append(li); return u; } },
  { re: /^>$/, make: (_m, d) => d.createElement('blockquote') },
];

function caretIn(node: Node, atEnd = false) {
  const s = window.getSelection(); if (!s) return;
  const r = document.createRange(); r.selectNodeContents(node); r.collapse(!atEnd); s.removeAllRanges(); s.addRange(r);
}
function placeholderBr(target: HTMLElement) { if (!target.textContent) target.append(document.createElement('br')); }

export function RichEditor({ value, onCommit, readOnly = false, label = 'Description', placeholder = 'Add description…' }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const last = useRef(value);
  const saved = useRef<Range | null>(null);
  const dirty = useRef(false); // set by every user edit: focus + blur without an edit must not write back a normalised description
  const [link, setLink] = useState<string | null>(null);
  const [active, setActive] = useState<{ bold: boolean; italic: boolean }>({ bold: false, italic: false });

  const syncEmpty = () => {
    const root = ref.current; if (!root) return;
    const empty = !root.textContent && !root.querySelector('hr,pre,li');
    if (empty && root.firstChild && !root.contains(document.activeElement)) root.replaceChildren();
    root.dataset.empty = empty ? 'true' : 'false';
  };
  // Every line lives in a block: an empty editor gets a paragraph on focus, and text typed at the top level is wrapped in one.
  const ensureBlock = () => {
    const root = ref.current; if (!root) return;
    if (!root.firstChild) { const p = document.createElement('p'); p.append(document.createElement('br')); root.append(p); caretIn(p); return; }
    const sel = window.getSelection();
    Array.from(root.childNodes).forEach((n) => {
      if (n.nodeType === 3 || (n.nodeType === 1 && !['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'BLOCKQUOTE', 'PRE', 'HR'].includes((n as Element).tagName))) {
        const at = sel?.anchorNode === n ? sel.anchorOffset : null;
        const p = document.createElement('p'); n.replaceWith(p); p.append(n);
        if (at !== null) { const r = document.createRange(); r.setStart(n, at); r.collapse(true); sel?.removeAllRanges(); sel?.addRange(r); }
      }
    });
  };
  const read = () => (ref.current ? blocksToMarkdown(readBlocks(ref.current)) : last.current);

  useEffect(() => {
    const root = ref.current; if (!root) return;
    try { document.execCommand('defaultParagraphSeparator', false, 'p'); document.execCommand('styleWithCSS', false, 'false'); } catch { /* unsupported */ }
    renderMarkdown(root, value); last.current = value; dirty.current = false; syncEmpty();
  }, []); // initial render only; later value changes are handled by the effect below
  useEffect(() => {
    const root = ref.current; if (!root || value === last.current) return;
    if (root.contains(document.activeElement)) return; // never overwrite what the user is typing
    renderMarkdown(root, value); last.current = value; dirty.current = false; syncEmpty();
  }, [value]);
  useEffect(() => {
    const onSel = () => {
      const root = ref.current; const s = window.getSelection();
      if (!root || !s || !s.anchorNode || !root.contains(s.anchorNode)) return;
      saved.current = s.rangeCount ? s.getRangeAt(0).cloneRange() : null;
      try { setActive({ bold: document.queryCommandState('bold'), italic: document.queryCommandState('italic') }); } catch { /* unsupported */ }
    };
    document.addEventListener('selectionchange', onSel);
    return () => document.removeEventListener('selectionchange', onSel);
  }, []);

  const commit = () => { if (!dirty.current) return; dirty.current = false; const md = read(); if (md !== last.current) { last.current = md; onCommit(md); } };
  const restore = () => { const s = window.getSelection(); if (s && saved.current) { s.removeAllRanges(); s.addRange(saved.current); } };
  const exec = (cmd: string, arg?: string) => { dirty.current = true; ref.current?.focus(); restore(); document.execCommand(cmd, false, arg); syncEmpty(); };

  const toggleBlock = (tag: 'h2' | 'blockquote' | 'pre') => {
    dirty.current = true; ref.current?.focus(); restore();
    const b = blockOf(ref.current as HTMLElement, window.getSelection()?.anchorNode ?? null);
    document.execCommand('formatBlock', false, b?.tagName.toLowerCase() === tag ? 'p' : tag);
    syncEmpty();
  };
  const toggleTasks = () => {
    dirty.current = true; ref.current?.focus(); restore();
    const b = blockOf(ref.current as HTMLElement, window.getSelection()?.anchorNode ?? null);
    if (!(b?.tagName === 'UL')) document.execCommand('insertUnorderedList');
    const ul = blockOf(ref.current as HTMLElement, window.getSelection()?.anchorNode ?? null);
    if (ul?.tagName !== 'UL') return;
    if (ul.dataset.tasks) { delete ul.dataset.tasks; ul.querySelectorAll('li').forEach((li) => { delete li.dataset.done; }); }
    else { ul.dataset.tasks = '1'; ul.querySelectorAll('li').forEach((li) => { li.dataset.done = li.dataset.done ?? '0'; }); }
  };
  const toggleCode = () => {
    dirty.current = true; ref.current?.focus(); restore();
    const s = window.getSelection(); if (!s || !s.rangeCount) return;
    const r = s.getRangeAt(0);
    const inCode = (r.commonAncestorContainer.nodeType === 1 ? (r.commonAncestorContainer as Element) : r.commonAncestorContainer.parentElement)?.closest('code');
    if (inCode && !inCode.closest('pre')) { inCode.replaceWith(...Array.from(inCode.childNodes)); return; }
    if (r.collapsed) return;
    const c = document.createElement('code'); c.textContent = r.toString(); r.deleteContents(); r.insertNode(c); caretIn(c, true);
  };
  const applyLink = (raw: string) => {
    const href = safeHref(raw.includes(':') || raw.startsWith('/') || raw.startsWith('#') ? raw : `https://${raw}`);
    setLink(null);
    if (!href || !/^(https?:|mailto:|\/|#)/i.test(href)) return;
    ref.current?.focus(); restore();
    const s = window.getSelection(); if (!s || !s.rangeCount) return;
    const r = s.getRangeAt(0);
    dirty.current = true;
    const a = document.createElement('a'); a.setAttribute('href', href);
    if (r.collapsed) a.textContent = href; else a.append(r.extractContents());
    r.insertNode(a); caretIn(a, true);
    syncEmpty();
  };

  const onInput = (e: React.FormEvent<HTMLDivElement>) => {
    const root = ref.current; if (!root) return;
    dirty.current = true;
    ensureBlock();
    const ne = e.nativeEvent as InputEvent;
    const sel = window.getSelection();
    if (ne.inputType === 'insertParagraph' && sel?.anchorNode) { // Enter inside a task list: the new item starts unchecked
      const li = (sel.anchorNode.nodeType === 1 ? (sel.anchorNode as Element) : sel.anchorNode.parentElement)?.closest('li');
      if (li && li.parentElement?.dataset.tasks) li.dataset.done = '0';
    }
    if (ne.inputType === 'insertText' && ne.data === ' ' && sel?.anchorNode) {
      const b = blockOf(root, sel.anchorNode);
      if (b && (b.tagName === 'P' || b.tagName === 'DIV')) {
        const t = (b.textContent ?? '').replace(/\u00a0/g, ' ');
        const m = t.endsWith(' ') ? SHORTCUTS.map((s) => ({ s, m: t.slice(0, -1).match(s.re) })).find((x) => x.m) : null;
        if (m && m.m) {
          const made = m.s.make(m.m, document);
          const inner = made.tagName === 'UL' || made.tagName === 'OL' ? (made.firstElementChild as HTMLElement) : made;
          placeholderBr(inner); b.replaceWith(made); caretIn(inner);
        }
      }
    }
    syncEmpty();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const root = ref.current; if (!root) return;
    const sel = window.getSelection();
    const b = sel?.anchorNode ? blockOf(root, sel.anchorNode) : null;
    if (['Enter', 'Backspace', 'Delete'].includes(e.key) || ((e.metaKey || e.ctrlKey) && e.key === 'e')) dirty.current = true; // handlers below edit the DOM without an input event
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); commit(); return; }
    if (e.key === 'Enter' && e.shiftKey) { e.preventDefault(); document.execCommand('insertParagraph'); return; } // no hard breaks in the stored subset
    if (e.key === 'Enter' && b && (b.tagName === 'PRE')) {
      e.preventDefault();
      const t = b.textContent ?? '';
      if (t.endsWith('\n') || t === '') { // second Enter on an empty line leaves the block
        const code = b.querySelector('code') ?? b; code.textContent = t.replace(/\n+$/, '');
        const p = document.createElement('p'); p.append(document.createElement('br')); b.after(p); caretIn(p); if (!b.textContent) b.remove();
      } else document.execCommand('insertText', false, '\n');
      return;
    }
    if (e.key === 'Enter' && b && (b.tagName === 'BLOCKQUOTE' || /^H[1-6]$/.test(b.tagName))) {
      e.preventDefault();
      const p = document.createElement('p'); p.append(document.createElement('br'));
      if (b.tagName === 'BLOCKQUOTE' && !b.textContent) b.replaceWith(p); else b.after(p);
      caretIn(p); return;
    }
    if (e.key === 'Backspace' && b && sel?.isCollapsed && sel.anchorOffset === 0 && /^(H[1-6]|BLOCKQUOTE|PRE)$/.test(b.tagName) && (sel.anchorNode === b || sel.anchorNode === b.firstChild || sel.anchorNode === b.firstChild?.firstChild)) {
      e.preventDefault(); // Backspace at the start of a heading/quote/code block turns it back into a paragraph
      const p = document.createElement('p'); p.append(...Array.from(b.childNodes)); placeholderBr(p); b.replaceWith(p); caretIn(p); return;
    }
    if (e.key === 'Tab') return; // never trap focus
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.shiftKey && (e.key === 's' || e.key === 'S' || e.key === 'x' || e.key === 'X')) { e.preventDefault(); exec('strikeThrough'); return; }
    if (mod && e.key === 'e') { e.preventDefault(); toggleCode(); }
  };

  const onPaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    e.preventDefault();
    dirty.current = true;
    const t = e.clipboardData.getData('text/plain').replace(/\r\n?/g, '\n');
    if (!t) return;
    if (!t.includes('\n')) { document.execCommand('insertText', false, t); return; }
    const blocks = parseMarkdown(t);
    const root = ref.current; const sel = window.getSelection(); if (!root || !sel?.anchorNode) return;
    if (!sel.isCollapsed) document.execCommand('delete');
    const at = blockOf(root, sel.anchorNode);
    const nodes = blocks.map((x) => blockNode(document, x));
    if (!nodes.length) return;
    if (at && !at.textContent) at.replaceWith(...nodes); else if (at) at.after(...nodes); else root.append(...nodes);
    syncEmpty();
    const lastNode = nodes[nodes.length - 1]; if (lastNode) caretIn(lastNode, true);
  };

  // Toolbar keyboard: arrows/Home/End move between buttons (WAI-ARIA toolbar); only the first button is a tab stop.
  const onBarKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(e.key) || (e.target as HTMLElement).tagName === 'INPUT') return;
    const bs = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('button.re-btn'));
    const k = bs.indexOf(e.target as HTMLButtonElement); if (k < 0) return;
    e.preventDefault();
    const n = e.key === 'Home' ? 0 : e.key === 'End' ? bs.length - 1 : (k + (e.key === 'ArrowRight' ? 1 : -1) + bs.length) % bs.length;
    bs[n]?.focus();
  };

  const onClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const li = (e.target as HTMLElement).closest?.('li');
    const ul = li?.parentElement;
    if (readOnly || !li || !ul?.dataset.tasks) return;
    const box = li.getBoundingClientRect();
    if (e.clientX - box.left > 24 || e.clientX < box.left) return; // only the checkbox gutter toggles
    li.dataset.done = li.dataset.done === '1' ? '0' : '1';
    dirty.current = true;
    commit();
  };

  // A plain render helper, not a component: a component defined here would remount (and drop tooltip state) on every render.
  const btn = (name: string, tip: string, on: () => void, icon: ReactNode, opts: { shortcut?: string[]; pressed?: boolean } = {}) => (
    <Tooltip label={tip} shortcut={opts.shortcut}><button type='button' className='re-btn' tabIndex={name === 'Bold' ? 0 : -1} aria-label={name} aria-pressed={opts.pressed} onMouseDown={(e) => e.preventDefault()} onClick={on}>{icon}</button></Tooltip>
  );

  return (
    <div className='re' data-readonly={readOnly || undefined} onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) commit(); }}>
      {!readOnly && (
        <div className='re-bar' role='toolbar' aria-label='Description formatting' onKeyDown={onBarKey} onMouseDown={(e) => { if ((e.target as HTMLElement).tagName !== 'INPUT') e.preventDefault(); }}>
          {btn('Bold', 'Bold', () => exec('bold'), ICON.bold, { shortcut: ['⌘', 'B'], pressed: active.bold })}
          {btn('Italic', 'Italic', () => exec('italic'), ICON.italic, { shortcut: ['⌘', 'I'], pressed: active.italic })}
          {btn('Strikethrough', 'Strikethrough', () => exec('strikeThrough'), ICON.strike, { shortcut: ['⌘', '⇧', 'S'] })}
          {btn('Inline code', 'Inline code', toggleCode, ICON.code, { shortcut: ['⌘', 'E'] })}
          {btn('Link', 'Link', () => { restore(); setLink(''); }, ICON.link)}
          <span className='re-sep' role='separator' aria-orientation='vertical' />
          {btn('Heading', 'Heading', () => toggleBlock('h2'), ICON.heading)}
          {btn('Bulleted list', 'Bulleted list', () => exec('insertUnorderedList'), ICON.ul)}
          {btn('Numbered list', 'Numbered list', () => exec('insertOrderedList'), ICON.ol)}
          {btn('Checklist', 'Checklist', toggleTasks, ICON.task)}
          {btn('Quote', 'Quote', () => toggleBlock('blockquote'), ICON.quote)}
          {btn('Code block', 'Code block', () => toggleBlock('pre'), ICON.pre)}
          {link !== null && (
            <form className='re-link' onSubmit={(e) => { e.preventDefault(); applyLink(link); }}>
              <input autoFocus aria-label='Link URL' placeholder='https://…' value={link} onChange={(e) => setLink(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setLink(null); ref.current?.focus(); restore(); } }} />
              <button type='submit' className='re-apply'>Apply</button>
            </form>
          )}
        </div>
      )}
      <div
        ref={ref} className='re-surface md' role='textbox' aria-multiline='true' aria-label={label} aria-readonly={readOnly || undefined}
        contentEditable={!readOnly} suppressContentEditableWarning spellCheck data-placeholder={placeholder} data-empty='true'
        onFocus={() => { if (!readOnly && !ref.current?.firstChild) ensureBlock(); }} onInput={onInput} onKeyDown={onKeyDown} onPaste={onPaste} onClick={onClick}
      />
    </div>
  );
}
