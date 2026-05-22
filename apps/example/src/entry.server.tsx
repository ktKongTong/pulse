import { renderToReadableStream } from "react-dom/server";
import type { AppLoadContext, EntryContext } from "react-router";
import { ServerRouter } from "react-router";

export default async function handleRequest(
  request: Request,
  status: number,
  headers: Headers,
  context: EntryContext,
  _loadContext: AppLoadContext,
) {
  const body = await renderToReadableStream(
    <ServerRouter context={context} url={request.url} />,
  );
  if (context.isSpaMode) await body.allReady;
  headers.set("Content-Type", "text/html");
  return new Response(body, { headers, status });
}
