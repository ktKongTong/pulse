import type { RoomRpc } from "../durable-stubs";

export interface RoomNamespaceLike<TId = DurableObjectId, TStub = DurableObjectStub> {
  idFromName(name: string): TId;
  get(id: TId): TStub;
}

type RoomBindingName =
  | "GLOBAL_STATUS_ROOM"
  | "PAGE_STATUS_ROOM"
  | "CHAT_ROOM";

interface RoomBindingEnv<TId = DurableObjectId, TStub = DurableObjectStub> {
  GLOBAL_STATUS_ROOM: RoomNamespaceLike<TId, TStub>;
  PAGE_STATUS_ROOM: RoomNamespaceLike<TId, TStub>;
  CHAT_ROOM: RoomNamespaceLike<TId, TStub>;
}

export function roomBindingName(roomId: string): RoomBindingName {
  if (roomId === "global") return "GLOBAL_STATUS_ROOM";
  if (roomId.startsWith("page:")) return "PAGE_STATUS_ROOM";
  if (roomId.startsWith("chat:")) return "CHAT_ROOM";
  throw new Error(`unsupported_room_id:${roomId}`);
}

export function roomNamespace<TId, TStub>(
  env: RoomBindingEnv<TId, TStub>,
  roomId: string,
): RoomNamespaceLike<TId, TStub> {
  return env[roomBindingName(roomId)];
}

export function realtimeRoomId<TId>(
  namespace: Pick<RoomNamespaceLike<TId>, "idFromName">,
  workspaceId: string,
  roomId: string,
): TId {
  return namespace.idFromName(`${workspaceId}:${roomId}`);
}

export function roomStub<TId, TStub>(
  env: RoomBindingEnv<TId, TStub>,
  workspaceId: string,
  roomId: string,
): RoomRpc {
  const namespace = roomNamespace(env, roomId);
  const id = realtimeRoomId(namespace, workspaceId, roomId);
  return namespace.get(id) as unknown as RoomRpc;
}
