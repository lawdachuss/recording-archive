const CORS_HOSTS: string[] = [
  "pixhost.to",
  "img2.pixhost.to",
  "lobfile.com",
  "files.catbox.moe",
  "catbox.moe",
  "i.ibb.co",
  "ibb.co",
  "pixeldrain.com",
  "www.pixeldrain.com",
];

function needsProxy(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const { hostname } = new URL(url);
    return CORS_HOSTS.some((h) => hostname.includes(h));
  } catch {
    return false;
  }
}

export function proxyUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (needsProxy(url)) {
    return `/api/media?url=${encodeURIComponent(url)}`;
  }
  return url;
}
