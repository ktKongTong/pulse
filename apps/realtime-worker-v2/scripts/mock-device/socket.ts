export type JsonObject = Record<string, unknown>;

export async function connectJsonSocket(url: string) {
  const socket = new WebSocket(url);
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener("open", () => resolve(), { once: true });
    socket.addEventListener("error", () => reject(new Error(`ws_connect_failed:${url}`)), {
      once: true,
    });
  });
  return new JsonSocket(socket);
}

export class JsonSocket {
  private jsonQueue: JsonObject[] = [];
  private waiters: Array<(value: JsonObject) => void> = [];
  private jsonHandlers = new Set<(value: JsonObject) => void>();

  constructor(private readonly socket: WebSocket) {
    socket.addEventListener("message", (event) => this.handleMessage(event.data));
    socket.addEventListener("close", () => {
      console.error(`socket closed: ${socket.url}`);
    });
  }

  sendJson(frame: JsonObject) {
    this.socket.send(JSON.stringify(frame));
  }

  sendBinary(bytes: Uint8Array<ArrayBuffer>) {
    this.socket.send(bytes);
  }

  onJson(handler: (value: JsonObject) => void) {
    this.jsonHandlers.add(handler);
  }

  nextJson() {
    const queued = this.jsonQueue.shift();
    if (queued) return Promise.resolve(queued);
    return new Promise<JsonObject>((resolve) => {
      this.waiters.push(resolve);
    });
  }

  private handleMessage(data: unknown) {
    if (typeof data !== "string") return;
    const parsed = JSON.parse(data) as JsonObject;
    for (const handler of this.jsonHandlers) handler(parsed);
    const waiter = this.waiters.shift();
    if (waiter) waiter(parsed);
    else this.jsonQueue.push(parsed);
  }
}
