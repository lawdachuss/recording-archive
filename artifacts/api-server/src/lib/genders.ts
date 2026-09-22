/**
 * genders.ts — canonical gender buckets.
 *
 * The recordings table stores messy, hand-entered gender strings
 * ("female", "f", "females", "male", "m", "couple", "maleFemale", "group").
 * Exposing every raw variant as a filter would produce near-identical
 * buckets ("f" vs "female") and make the UI misleading. These buckets map
 * the raw column values to a small set of filterable categories.
 */

export interface GenderBucket {
  /** Canonical filter value, used in the URL (e.g. `?gender=female`). */
  value: string;
  /** Raw DB values that belong to this bucket. */
  matches: string[];
}

export const GENDER_BUCKETS: GenderBucket[] = [
  { value: "female", matches: ["female", "f", "females"] },
  { value: "male", matches: ["male", "m"] },
  { value: "couple", matches: ["couple", "maleFemale"] },
  { value: "group", matches: ["group"] },
  // No trans recordings exist in the catalog today, but keep the bucket so
  // raw trans values are still matched instead of silently dropped.
  { value: "trans", matches: ["trans", "transgender", "t"] },
];

/**
 * Resolve a user-supplied gender filter value into the list of raw DB values
 * that should match. Accepts both the canonical bucket value and any raw
 * alias found in the data (e.g. `?gender=f` or legacy `?gender=maleFemale`).
 * Unknown values fall back to an exact match so results are never widened.
 */
export function resolveGenderBucket(value: string): string[] | null {
  const key = value.trim();
  const lower = key.toLowerCase();
  if (!lower) return null;

  for (const bucket of GENDER_BUCKETS) {
    if (bucket.value.toLowerCase() === lower) return bucket.matches;
    if (bucket.matches.some((m) => m.toLowerCase() === lower)) return bucket.matches;
  }

  return [key];
}