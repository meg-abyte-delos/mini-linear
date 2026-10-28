import { describe, it, expect } from 'vitest';
import { parseMarkdown, parseInline, safeHref } from '@/lib/detail/markdown';

describe('safeHref', () => {
  it.each(['javascript:alert(1)', 'JaVaScRiPt:alert(1)', ' java\tscript:alert(1)', 'data:text/html,<script>', 'vbscript:x', '//evil.com', 'file:///etc/passwd', ''])('rejects %j', (u) => expect(safeHref(u)).toBeNull());
  it.each(['https://linear.app/x', 'http://a.b', 'mailto:a@b.c', '/w/delos/issue/DEL-1', '#h'])('allows %j', (u) => expect(safeHref(u)).toBe(u));
});

describe('parseInline', () => {
  it('never emits raw html, only text', () => {
    const t = parseInline('<img src=x onerror=alert(1)>');
    expect(t).toEqual([{ t: 'text', v: '<img src=x onerror=alert(1)>' }]);
  });
  it('drops unsafe links but keeps their text', () => {
    expect(parseInline('[click](javascript:alert(1))')).toEqual([{ t: 'text', v: 'click' }]);
  });
  it('parses bold, em, code, strike, links, mentions', () => {
    const t = parseInline('**b** _i_ `c` ~~s~~ [l](https://x.io) @meg @[Ada Byte](0193a1b2-0000-7000-8000-000000000001)');
    expect(t.map((n) => n.t)).toEqual(['strong', 'text', 'em', 'text', 'code', 'text', 'del', 'text', 'link', 'text', 'mention', 'text', 'mention']);
  });
  it('does not treat emails or snake_case as mention/em', () => {
    expect(parseInline('a@b.c').map((n) => n.t)).toEqual(['text']);
    expect(parseInline('snake_case_name').map((n) => n.t)).toEqual(['text']);
  });
  it('autolinks bare urls without trailing punctuation', () => {
    const t = parseInline('see https://x.io/a.');
    expect(t[1]).toMatchObject({ t: 'link', href: 'https://x.io/a' });
  });
});

describe('parseMarkdown', () => {
  it('handles headings, lists, tasks, quotes, code fences, hr', () => {
    const b = parseMarkdown('# H\n\n- a\n- b\n\n1. x\n2. y\n\n- [ ] t\n- [x] u\n\n> q\n\n```\n<b>raw</b>\n```\n\n---\npara\nline');
    expect(b.map((x) => x.t)).toEqual(['h', 'ul', 'ol', 'task', 'quote', 'pre', 'hr', 'p']);
    expect(b[5]).toEqual({ t: 'pre', v: '<b>raw</b>' });
  });
  it('empty input gives no blocks', () => expect(parseMarkdown('  \n ')).toEqual([]));
});
