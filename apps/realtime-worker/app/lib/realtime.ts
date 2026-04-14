export function currentArticleUrl(slug: string): string {
  if (typeof window === "undefined") {
    return `/article/${slug}`;
  }
  return new URL(`/article/${slug}`, window.location.origin).toString();
}
