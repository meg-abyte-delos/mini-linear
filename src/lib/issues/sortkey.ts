// Fractional string keys (base36, ASCII order = collate "C"): between(lo, hi) is strictly between two keys.
const A = "0123456789abcdefghijklmnopqrstuvwxyz";
const at = (s: string, i: number) => A.indexOf(s[i] as string);
/** A key k with lo < k < hi (null = open end). Throws when lo >= hi. */
export function between(lo: string | null, hi: string | null): string {
  const l0 = lo ?? "";
  if (hi !== null && l0 >= hi) throw new Error("between: lo must be < hi");
  let out = "", tight = hi !== null;
  for (let i = 0; ; i++) {
    const l = i < l0.length ? at(l0, i) : 0;
    const h = tight ? (i < (hi as string).length ? at(hi as string, i) : 0) : 36;
    if (l === h) { out += A[l]; continue; }
    if (h - l > 1) return out + A[Math.floor((l + h) / 2)];
    out += A[l]; tight = false;
  }
}
