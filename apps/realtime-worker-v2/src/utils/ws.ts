export function socketAttachment<T>(socket: WebSocket): T | null {
  try {
    return socket.deserializeAttachment() as T;
  } catch {
    return null;
  }
}

export function safeSend(socket: WebSocket | null | undefined, frame: unknown) {
  if (!socket) return false;
  try {
    socket.send(JSON.stringify(frame));
    return true;
  } catch {
    return false;
  }
}

export function closeWith(
  socket: WebSocket | null | undefined,
  code: number,
  reason: string,
) {
  if (!socket) return;
  try {
    socket.close(code, reason);
  } catch {
    // Closing best effort only.
  }
}
