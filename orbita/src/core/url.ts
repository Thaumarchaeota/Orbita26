export function normalizeUrl(url: string): string {
  const t = url.trim();
  return t.startsWith("http") ? t : `https://${t}`;
}
