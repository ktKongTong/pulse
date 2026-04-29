import type { LiveListenRpc } from "../durable-stubs";
import type { Env } from "../config/env";

export function liveListenStub(env: Env, workspaceId: string, roomId: string): LiveListenRpc {
  const id = env.LIVE_LISTEN_ROOM.idFromName(`${workspaceId}:${roomId}`);
  return env.LIVE_LISTEN_ROOM.get(id) as unknown as LiveListenRpc;
}
