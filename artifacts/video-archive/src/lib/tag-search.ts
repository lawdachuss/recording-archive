export interface TagCount {
  tag: string;
  count: number;
}

function normalizeTagSearch(value: string): string {
  return value.normalize("NFKC").trim().toLowerCase();
}

/** Return tags whose names contain the normalized query, preserving their input order. */
export function filterTagsByQuery(
  tags: readonly TagCount[],
  query: string,
): TagCount[] {
  const normalizedQuery = normalizeTagSearch(query);
  if (!normalizedQuery) return [...tags];

  return tags.filter(({ tag }) => normalizeTagSearch(tag).includes(normalizedQuery));
}

/** Sort by popularity, then by a deterministic case-insensitive name order. */
export function sortTagsByCount(tags: readonly TagCount[]): TagCount[] {
  return [...tags].sort((a, b) => {
    const countDifference = b.count - a.count;
    if (countDifference !== 0) return countDifference;

    const left = normalizeTagSearch(a.tag);
    const right = normalizeTagSearch(b.tag);
    if (left < right) return -1;
    if (left > right) return 1;
    if (a.tag < b.tag) return -1;
    if (a.tag > b.tag) return 1;
    return 0;
  });
}
