import { describe, expect, it } from 'vitest';
import { highlightParts, searchLocal } from '@/lib/search-client';
import { seedIssues } from '@/lib/issues';

describe('highlightParts', () => {
  it('marks every case-insensitive occurrence of each word', () => {
    expect(highlightParts('Cronkit parser for cron jobs', 'cron')).toEqual([
      { text: 'Cron', mark: true }, { text: 'kit parser for ', mark: false }, { text: 'cron', mark: true }, { text: ' jobs', mark: false },
    ]);
  });
  it('returns the text untouched without a usable query and escapes regex characters', () => {
    expect(highlightParts('a (b) c', 'a')).toEqual([{ text: 'a (b) c', mark: false }]);
    expect(highlightParts('x (b) y', '(b)')).toEqual([{ text: 'x ', mark: false }, { text: '(b)', mark: true }, { text: ' y', mark: false }]);
  });
  it('mock search builds a marked excerpt when only the description matches', () => {
    const [i] = seedIssues(1); const issue = { ...i!, title: 'zzz title', description: 'a long text mentioning wombat somewhere' };
    const hit = searchLocal([issue], 'wombat').items[0]!;
    expect(hit.snippet).toContain('<mark>wombat</mark>');
  });
});
