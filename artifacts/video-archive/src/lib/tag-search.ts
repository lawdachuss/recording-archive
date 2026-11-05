export interface TagCount {
  tag: string;
  count: number;
}

function normalizeTagSearch(value: unknown): string {
  return typeof value === "string"
    ? value.normalize("NFKC").trim().toLowerCase()
    : "";
}

/** Keep only plain tag records with a usable label and a finite, non-negative count. */
function getValidTags(value: unknown): TagCount[] {
  if (!Array.isArray(value)) return [];

  return value.filter((item): item is TagCount => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      return false;
    }

    const candidate = item as Record<string, unknown>;
    return (
      typeof candidate.tag === "string" &&
      candidate.tag.trim().length > 0 &&
      typeof candidate.count === "number" &&
      Number.isFinite(candidate.count) &&
      candidate.count >= 0
    );
  });
}

/** Return valid tags whose names contain the normalized query, preserving input order. */
export function filterTagsByQuery(
  tags: unknown,
  query: unknown,
): TagCount[] {
  const validTags = getValidTags(tags);
  const normalizedQuery = normalizeTagSearch(query);
  if (!normalizedQuery) return validTags;

  return validTags.filter(({ tag }) =>
    normalizeTagSearch(tag).includes(normalizedQuery),
  );
}

/** Sort valid tags by popularity, then by a deterministic case-insensitive name order. */
export function sortTagsByCount(tags: unknown): TagCount[] {
  return getValidTags(tags).sort((a, b) => {
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
