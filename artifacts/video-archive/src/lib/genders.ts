/**
 * genders.ts — gender filter options derived from the categories that
 * actually exist in the catalog. The underlying recordings column contains
 * messy raw values ("f", "females", "m", "maleFemale", ...); the API server
 * canonicalizes them into these buckets, so every option here is guaranteed
 * to return real results.
 */
export interface GenderOption {
  value: string;
  label: string;
}

export const GENDER_OPTIONS: GenderOption[] = [
  { value: "female", label: "Female" },
  { value: "male", label: "Male" },
  { value: "couple", label: "Couple" },
  { value: "group", label: "Group" },
];

export function genderLabel(value: string): string {
  const match = GENDER_OPTIONS.find((g) => g.value === value);
  if (match) return match.label;
  return value;
}