import type { DeviceRpc } from "../durable-stubs";
import type { Env } from "../config/env";

export function deviceStub(env: Env, workspaceId: string, deviceId: string): DeviceRpc {
  const id = env.DEVICE_DO.idFromName(`${workspaceId}:${deviceId}`);
  return env.DEVICE_DO.get(id) as unknown as DeviceRpc;
}
