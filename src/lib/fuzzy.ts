// Subsequence fuzzy match; lower score is better, null = no match.
export function fuzzyScore(query: string, text: string): number | null {
  const q = query.toLowerCase(), t = text.toLowerCase();
  let ti = 0, score = 0, last = -1;
  for (const ch of q) {
    const idx = t.indexOf(ch, ti);
    if (idx < 0) return null;
    score += last < 0 ? idx : idx - last - 1;
    last = idx; ti = idx + 1;
  }
  return score;
}
export function fuzzyFilter<T>(items: T[], query: string, label: (x: T) => string): T[] {
  if (!query) return items;
  return items
    .map((x) => ({ x, s: fuzzyScore(query, label(x)) }))
    .filter((r): r is { x: T; s: number } => r.s !== null)
    .sort((a, b) => a.s - b.s)
    .map((r) => r.x);
}
