export function requireWebSocket(request: Request) {
  return request.headers.get("Upgrade") === "websocket";
}

export function json(data: unknown, status = 200) {
  return Response.json(data, { status });
}

export function badRequest(message: string) {
  return json({ error: message }, 400);
}

export function notFound() {
  return json({ error: "not_found" }, 404);
}
