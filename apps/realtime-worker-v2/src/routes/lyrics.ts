import { Hono } from "hono";

const LYRICS_API_URL = "https://api.lrc.cx/lyrics";

export const lyricsRoutes = new Hono();

lyricsRoutes.get("/", async (c) => {
  const title = trimParam(c.req.query("title") ?? null);
  if (!title) return c.json({ error: "missing_title" }, 400);

  const upstreamUrl = new URL(LYRICS_API_URL);
  upstreamUrl.searchParams.set("title", title);

  const artist = trimParam(c.req.query("artist") ?? null);
  const album = trimParam(c.req.query("album") ?? null);
  if (artist) upstreamUrl.searchParams.set("artist", artist);
  if (album) upstreamUrl.searchParams.set("album", album);

  try {
    const upstream = await fetch(upstreamUrl, {
      headers: { accept: "text/plain, text/lrc;q=0.9, */*;q=0.8" },
    });
    return new Response(await upstream.text(), {
      status: upstream.status,
      headers: {
        "Cache-Control": upstream.ok
          ? "public, max-age=300, stale-while-revalidate=86400"
          : "no-store",
        "Content-Type": "text/plain; charset=utf-8",
      },
    });
  } catch {
    return c.json({ error: "lyrics_upstream_unavailable" }, 502);
  }
});

function trimParam(value: string | null) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}
