export function createAcceptedPair() {
  const pair = new WebSocketPair();
  const [client, server] = Object.values(pair);
  return { client, server };
}

export function upgradeResponse(client: WebSocket) {
  return new Response(null, { status: 101, webSocket: client });
}
