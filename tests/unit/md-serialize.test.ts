import { describe, it, expect } from 'vitest';
import { parseMarkdown } from '@/lib/detail/markdown';
import { blocksToMarkdown, inlineToMarkdown } from '@/lib/detail/md-serialize';

const rt = (md: string) => blocksToMarkdown(parseMarkdown(md));

describe('blocksToMarkdown', () => {
  it.each([
    '# Title\n\nSome **bold**, _italic_, ~~gone~~ and `code`.',
    '- one\n- two\n- three',
    '1. first\n2. second',
    '- [ ] todo\n- [x] done',
    '> quoted text',
    '```\nconst a = 1;\n\nconst b = 2;\n```',
    '---',
    'See [the docs](https://linear.app/docs) and https://example.com/a_b_c now.',
    'Ping @meg and @[Ada Byte](0193a1b2-0000-7000-8000-000000000001) please.',
  ])('round-trips %j', (md) => expect(rt(md)).toBe(md));

  it('is stable: parsing the output gives the same tree', () => {
    const md = '## H\n\ntext with **b _i_ b**\n\n- a\n- b\n\n- [x] t\n\n> q\n\n```\ncode\n```';
    expect(parseMarkdown(rt(md))).toEqual(parseMarkdown(md));
  });
  it('escapes markdown syntax typed as plain text so it reads back as text', () => {
    const tree = [{ t: 'p' as const, c: [{ t: 'text' as const, v: '2 * 3 * 4 and snake_case_name and `tick` and [x](y)' }] }];
    expect(parseMarkdown(blocksToMarkdown(tree))).toEqual(tree);
  });
  it('guards a paragraph that would otherwise read as another block', () => {
    for (const v of ['# not a heading', '- not a list', '1. not a list', '> not a quote', '```not a fence', '---']) {
      const tree = [{ t: 'p' as const, c: [{ t: 'text' as const, v }] }];
      expect(parseMarkdown(blocksToMarkdown(tree))).toEqual(tree);
    }
  });
  it('keeps edge whitespace outside emphasis markers', () => {
    expect(inlineToMarkdown([{ t: 'strong', c: [{ t: 'text', v: ' x ' }] }])).toBe(' **x** ');
    expect(inlineToMarkdown([{ t: 'em', c: [{ t: 'text', v: '' }] }])).toBe('');
  });
  it('drops unsafe link targets but keeps the text, and skips empty blocks', () => {
    expect(inlineToMarkdown([{ t: 'link', href: 'javascript:alert(1)', c: [{ t: 'text', v: 'x' }] }])).toBe('x');
    expect(blocksToMarkdown([{ t: 'p', c: [] }, { t: 'ul', items: [[], [{ t: 'text', v: 'a' }]] }])).toBe('- a');
  });
  it('turns nbsp into a plain space and returns an empty string for no blocks', () => {
    expect(inlineToMarkdown([{ t: 'text', v: 'a\u00a0b' }])).toBe('a b');
    expect(blocksToMarkdown([])).toBe('');
  });
});
