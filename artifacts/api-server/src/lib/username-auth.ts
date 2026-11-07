/** Normalize and validate a username before using it for authentication lookup. */
export function normalizeLoginUsername(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const username = value.trim().toLowerCase();
  return /^[a-z0-9_-]{3,30}$/.test(username) ? username : null;
}
