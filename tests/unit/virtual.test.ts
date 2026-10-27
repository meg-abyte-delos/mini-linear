import { describe, it, expect } from 'vitest';
import { visibleWindow, scrollToIndex, CARD_H, cardHeight, visibleWindowVar } from '../../src/lib/virtual';

describe('visibleWindow (A4.3)', () => {
  it('renders a small slice of 2,000 items', () => {
    const w = visibleWindow(2000, 0, 600);
    expect(w.start).toBe(0);
    expect(w.end - w.start).toBeLessThan(20);
    expect(w.padBottom).toBe((2000 - w.end) * CARD_H);
  });
  it('keeps total height constant (pads + rendered = count * itemH)', () => {
    for (const st of [0, 1234, 50_000, 183_000]) {
      const w = visibleWindow(2000, st, 600);
      expect(w.padTop + (w.end - w.start) * CARD_H + w.padBottom).toBe(2000 * CARD_H);
    }
  });
  it('clamps at the end and handles empty / tiny lists', () => {
    expect(visibleWindow(0, 0, 600)).toEqual({ start: 0, end: 0, padTop: 0, padBottom: 0 });
    const w = visibleWindow(3, 99999, 600);
    expect(w.end).toBe(3);
    expect(w.start).toBeLessThan(3);
  });
});
describe('scrollToIndex', () => {
  it('scrolls up, down, or stays', () => {
    expect(scrollToIndex(0, 500, 600)).toBe(0);
    expect(scrollToIndex(20, 0, 600)).toBe(20 * CARD_H + CARD_H - 600);
    expect(scrollToIndex(2, 0, 600)).toBe(0);
  });
});

describe('variable heights', () => {
  it('cardHeight grows with 3+ labels', () => {
    expect(cardHeight(0)).toBe(CARD_H);
    expect(cardHeight(2)).toBe(CARD_H);
    expect(cardHeight(3)).toBeGreaterThan(CARD_H);
  });
  it('window pads add up to the total', () => {
    const hs = Array.from({ length: 500 }, (_, k) => cardHeight(k % 5));
    const total = hs.reduce((a, b) => a + b, 0);
    const w = visibleWindowVar(hs, 3000, 600);
    expect(w.padTop + hs.slice(w.start, w.end).reduce((a, b) => a + b, 0) + w.padBottom).toBe(total);
  });
});
