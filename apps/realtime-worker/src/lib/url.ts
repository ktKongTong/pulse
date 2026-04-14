const TRACKING_PREFIXES = ["utm_"];
const TRACKING_KEYS = new Set(["fbclid", "gclid"]);

export function canonicalizeUrl(rawUrl: string, explicitCanonicalUrl?: string): string {
  const candidate = explicitCanonicalUrl || rawUrl;
  const url = new URL(candidate);

  url.hash = "";

  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_KEYS.has(key) || TRACKING_PREFIXES.some((prefix) => key.startsWith(prefix))) {
      url.searchParams.delete(key);
    }
  }

  return url.toString();
}

export function pageRoomId(canonicalUrl: string): string {
  return `page:${canonicalUrl}`;
}
