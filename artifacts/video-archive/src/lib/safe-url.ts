/**
 * Accept only absolute HTTP(S) URLs from external data before they reach
 * navigation or iframe src attributes. This rejects javascript:, data:, blob:,
 * file:, protocol-relative, relative, and credential-bearing URLs.
 */
export function safeExternalUrl(value: string | null | undefined): string | null {
  if (typeof value !== "string" || !value.trim()) return null;

  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (!url.hostname || url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}
