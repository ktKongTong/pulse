export function resolveHttpUrl(baseUrl: string | undefined, path: string) {
  if (baseUrl) return new URL(path, baseUrl).toString();
  if (typeof window === "undefined") return path;
  return new URL(path, window.location.origin).toString();
}

export function resolveWsUrl(baseUrl: string | undefined, path: string) {
  const url = new URL(resolveHttpUrl(baseUrl, path));
  if (url.protocol === "https:") url.protocol = "wss:";
  else if (url.protocol === "http:") url.protocol = "ws:";
  return url.toString();
}
