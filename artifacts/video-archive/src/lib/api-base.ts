/**
 * Returns the base URL for API requests.
 * Reads from the VITE_API_URL environment variable (set at build time).
 * Falls back to an empty string for same-origin requests (the default).
 */
export function getApiBaseUrl(): string {
  const url = import.meta.env.VITE_API_URL as string | undefined;
  return url ? url.replace(/\/+$/, "") : "";
}

/**
 * Prepends the API base URL to a relative path.
 * If the path is already absolute or VITE_API_URL is not set, returns the path as-is.
 */
export function resolveApiPath(path: string): string {
  const base = getApiBaseUrl();
  if (!base) return path;
  // Only prepend to relative paths starting with /
  if (!path.startsWith("/")) return path;
  return `${base}${path}`;
}
