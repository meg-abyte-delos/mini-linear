import { describe, expect, it } from 'vitest';
import { DISPLAY_PROP_DEFAULT_OFF, DISPLAY_PROP_LABEL, estimateText, withoutSubIssues } from '@/lib/list-ui';

describe('display properties', () => {
  it('offers Linear\'s properties and keeps the new columns off by default', () => {
    expect(Object.values(DISPLAY_PROP_LABEL)).toEqual(expect.arrayContaining(['Due date', 'Estimate', 'Cycle', 'Updated']));
    expect([...DISPLAY_PROP_DEFAULT_OFF].sort()).toEqual(['cycle', 'due', 'estimate', 'updated']);
  });
  it('hides sub-issues only when asked', () => {
    const l = [{ id: 'a', parent_id: null }, { id: 'b', parent_id: 'a' }];
    expect(withoutSubIssues(l, true)).toHaveLength(2);
    expect(withoutSubIssues(l, false).map((x) => x.id)).toEqual(['a']);
  });
  it('formats estimates', () => { expect(estimateText(null)).toBe(''); expect(estimateText(0)).toBe('0'); expect(estimateText(5)).toBe('5'); });
});
