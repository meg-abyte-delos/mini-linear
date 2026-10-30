// Windowing for board columns (A4.3). Pure so it can be unit tested.
export const CARD_H = 92; // minimum card height (86) + top gap (6), in px
export const CHIP_ROW_H = 22; // extra height per wrapped row of label chips

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

/** Estimated slot height of a card: grows by one chip row per 3 labels, since .card height is auto. */
export const TITLE_LINE_H = 18; // .card-title wraps to 2 lines (line-clamp) past ~TITLE_CHARS_PER_LINE
export const TITLE_CHARS_PER_LINE = 38;
export function cardHeight(labelCount: number, titleLength = 0): number {
  const rows = Math.max(1, Math.ceil((labelCount + 1) / 3));
  const extra = titleLength > TITLE_CHARS_PER_LINE ? TITLE_LINE_H : 0;
  return CARD_H + (rows - 1) * CHIP_ROW_H + extra;
}

/** Window over items of varying height (prefix sums). */
export function visibleWindowVar(heights: number[], scrollTop: number, viewportH: number, overscan = 4): Window {
  const n = heights.length;
  if (n <= 0) return { start: 0, end: 0, padTop: 0, padBottom: 0 };
  const offs: number[] = [0];
  for (let k = 0; k < n; k++) offs.push(offs[k]! + heights[k]!);
  const st = Math.max(0, scrollTop), bottom = st + Math.max(0, viewportH);
  let first = 0; while (first < n - 1 && offs[first + 1]! <= st) first++;
  let last = first; while (last < n && offs[last]! < bottom) last++;
  const start = Math.min(Math.max(0, first - overscan), n - 1);
  const end = Math.min(n, Math.max(start + 1, last + overscan));
  return { start, end, padTop: offs[start]!, padBottom: offs[n]! - offs[end]! };
}

/** scrollTop bringing item `index` into view, over variable heights. */
export function scrollToIndexVar(heights: number[], index: number, scrollTop: number, viewportH: number): number {
  let top = 0; for (let k = 0; k < index; k++) top += heights[k]!;
  const h = heights[index] ?? CARD_H;
  if (top < scrollTop) return top;
  if (top + h > scrollTop + viewportH) return top + h - viewportH;
  return scrollTop;
}
