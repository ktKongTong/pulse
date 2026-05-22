export function closeSocket(socket: WebSocket | null) {
  if (!socket) return;
  if (
    socket.readyState === WebSocket.CLOSING ||
    socket.readyState === WebSocket.CLOSED
  ) {
    return;
  }
  socket.close();
}

export function isSocketOpenOrConnecting(socket: WebSocket | null) {
  return (
    socket?.readyState === WebSocket.OPEN ||
    socket?.readyState === WebSocket.CONNECTING
  );
}
