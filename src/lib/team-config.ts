// Shared (client + server) team configuration constants. Pure, no I/O.
// Workflow states (0101) and cycle config (0301) have their own APIs; only estimate scales are configured here.
export const ESTIMATE_SCALES = ["none", "linear", "fibonacci", "exponential", "tshirt"] as const;
export type EstimateScale = (typeof ESTIMATE_SCALES)[number];

/** issues.estimate is an integer 0..64 (0101 / issues API): every scale maps to numbers in that range. */
export const ESTIMATE_MAX = 64;
export type EstimateOption = { value: number; label: string };
const nums = (a: number[]): EstimateOption[] => a.map((n) => ({ value: n, label: String(n) }));
const POINTS: Record<Exclude<EstimateScale, "none">, EstimateOption[]> = {
  linear: nums([1, 2, 3, 4, 5]),
  fibonacci: nums([1, 2, 3, 5, 8]),
  exponential: nums([1, 2, 4, 8, 16]),
  // T-shirt sizes are stored as the numbers 1,2,3,5,8 (Linear's mapping) and shown as sizes.
  tshirt: [{ value: 1, label: "XS" }, { value: 2, label: "S" }, { value: 3, label: "M" }, { value: 5, label: "L" }, { value: 8, label: "XL" }],
};
/** Allowed estimates for a team, in display order (zero is opt-in; not offered for t-shirt sizes). */
export function estimateOptions(scale: EstimateScale, allowZero = false): EstimateOption[] {
  if (scale === "none") return [];
  const v = POINTS[scale];
  return allowZero && scale !== "tshirt" ? [{ value: 0, label: "0" }, ...v] : [...v];
}
export const estimateValues = (scale: EstimateScale, allowZero = false): number[] => estimateOptions(scale, allowZero).map((o) => o.value);
export const HEX = /^#[0-9a-fA-F]{6}$/;
