// Fixed-height windowing for board columns (A4.3). Pure so it can be unit tested.
export const CARD_H = 92; // card height + gap, in px; .card has a fixed height in CSS

export interface Window { start: number; end: number; padTop: number; padBottom: number }

export function visibleWindow(count: number, scrollTop: number, viewportH: number, itemH = CARD_H, overscan = 4): Window {
  if (count <= 0) return { start: 0, end: 0, padTop: 0, padBottom: 0 };
  const first = Math.floor(Math.max(0, scrollTop) / itemH);
  const last = Math.ceil((Math.max(0, scrollTop) + Math.max(0, viewportH)) / itemH);
  const start = Math.min(Math.max(0, first - overscan), count - 1);
  const end = Math.min(count, Math.max(start + 1, last + overscan));
  return { start, end, padTop: start * itemH, padBottom: (count - end) * itemH };
}

/** scrollTop that brings item `index` fully into view, or the current one when it already is. */
export function scrollToIndex(index: number, scrollTop: number, viewportH: number, itemH = CARD_H): number {
  const top = index * itemH;
  if (top < scrollTop) return top;
  if (top + itemH > scrollTop + viewportH) return top + itemH - viewportH;
  return scrollTop;
}
