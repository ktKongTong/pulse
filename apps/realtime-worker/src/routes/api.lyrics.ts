import type { LoaderFunctionArgs } from "react-router";

const LYRICS_API_URL = "https://api.lrc.cx/lyrics";

function trimParam(value: string | null) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

export async function loader({ request }: LoaderFunctionArgs) {
  const requestUrl = new URL(request.url);
  const title = trimParam(requestUrl.searchParams.get("title"));

  if (!title) {
    return Response.json(
      { error: "missing_title" },
      { status: 400 },
    );
  }

  const upstreamUrl = new URL(LYRICS_API_URL);
  upstreamUrl.searchParams.set("title", title);

  const album = trimParam(requestUrl.searchParams.get("album"));
  const artist = trimParam(requestUrl.searchParams.get("artist"));

  if (album) upstreamUrl.searchParams.set("album", album);
  if (artist) upstreamUrl.searchParams.set("artist", artist);

  try {
    const upstream = await fetch(upstreamUrl, {
      headers: {
        accept: "text/plain, text/lrc;q=0.9, */*;q=0.8",
      },
    });
    const body = await upstream.text();

    return new Response(body, {
      status: upstream.status,
      headers: {
        "Cache-Control": upstream.ok
          ? "public, max-age=300, stale-while-revalidate=86400"
          : "no-store",
        "Content-Type": "text/plain; charset=utf-8",
      },
    });
  } catch {
    return Response.json(
      { error: "lyrics_upstream_unavailable" },
      { status: 502 },
    );
  }
}
