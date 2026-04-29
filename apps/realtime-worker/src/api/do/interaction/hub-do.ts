import { DurableObject } from "cloudflare:workers";
import {
  INTERACTION_STREAM_PROTOCOL_V1,
  InteractionStateSchema,
  type InteractionState,
  type DeviceInteractionHello
} from "@pulse/realtime-protocol";

import type { Env } from "../../config/env";

interface RegisteredDevice {
  deviceId: string;
  connected: boolean;
  capabilities: DeviceInteractionHello["capabilities"];
  updatedAt: string;
}

interface StoredHubState {
  workspaceId: string;
  requests: Record<string, InteractionState>;
  devices: Record<string, RegisteredDevice>;
}

const HUB_STATE_KEY = "interaction-hub-state";

export class InteractionHub extends DurableObject<Env> {
  private hubState?: StoredHubState;
  private sseClients = new Set<ReadableStreamDefaultController<Uint8Array>>();

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const state = await this.getState(request);

    switch (url.pathname) {
      case "/internal/create-request":
        return this.handleCreateRequest(request, state);
      case "/internal/get-request":
        return this.handleGetRequest(url, state);
      case "/internal/register-device":
        return this.handleRegisterDevice(request, state);
      case "/internal/list-devices":
        return Response.json(Object.values(state.devices));
      case "/internal/update-request":
        return this.handleUpdateRequest(request, state);
      case "/internal/stream":
        return this.handleSse(state);
      default:
        return new Response("Not found", { status: 404 });
    }
  }

  private async handleCreateRequest(request: Request, state: StoredHubState): Promise<Response> {
    const payload = (await request.json()) as InteractionState;
    const parsed = InteractionStateSchema.parse(payload);
    state.requests[parsed.requestId] = parsed;
    await this.persist(state);
    await this.broadcast(parsed);
    return Response.json(parsed);
  }

  private async handleGetRequest(url: URL, state: StoredHubState): Promise<Response> {
    const requestId = url.searchParams.get("requestId");
    if (!requestId) {
      return Response.json({ error: "requestId_required" }, { status: 400 });
    }
    const request = state.requests[requestId];
    if (!request) {
      return Response.json({ error: "not_found" }, { status: 404 });
    }
    return Response.json(request);
  }

  private async handleRegisterDevice(request: Request, state: StoredHubState): Promise<Response> {
    const payload = (await request.json()) as {
      deviceId: string;
      capabilities: DeviceInteractionHello["capabilities"];
      connected: boolean;
      updatedAt: string;
    };
    state.devices[payload.deviceId] = {
      deviceId: payload.deviceId,
      capabilities: payload.capabilities,
      connected: payload.connected,
      updatedAt: payload.updatedAt
    };
    await this.persist(state);
    return Response.json(state.devices[payload.deviceId]);
  }

  private async handleUpdateRequest(request: Request, state: StoredHubState): Promise<Response> {
    const payload = (await request.json()) as InteractionState;
    const parsed = InteractionStateSchema.parse(payload);
    state.requests[parsed.requestId] = parsed;
    await this.persist(state);
    await this.broadcast(parsed);
    return Response.json(parsed);
  }

  private async handleSse(_state: StoredHubState): Promise<Response> {
    const stream = new ReadableStream<Uint8Array>({
      start: (controller) => {
        this.sseClients.add(controller);
      },
      cancel: () => {}
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive"
      }
    });
  }

  private async broadcast(state: InteractionState) {
    const payload = new TextEncoder().encode(
      `data: ${JSON.stringify({
        protocol: INTERACTION_STREAM_PROTOCOL_V1,
        kind: "interaction.updated",
        workspaceId: state.workspaceId,
        payload: state
      })}\n\n`
    );
    for (const controller of this.sseClients) {
      try {
        controller.enqueue(payload);
      } catch {
        this.sseClients.delete(controller);
      }
    }
  }

  private async getState(request?: Request): Promise<StoredHubState> {
    if (this.hubState) return this.hubState;
    const loaded = await this.ctx.storage.get<StoredHubState>(HUB_STATE_KEY);
    const workspaceId = request ? request.headers.get("x-workspace-id") ?? this.env.WORKSPACE_ID : this.env.WORKSPACE_ID;
    this.hubState = loaded ?? {
      workspaceId,
      requests: {},
      devices: {}
    };
    return this.hubState;
  }

  private async persist(state: StoredHubState) {
    this.hubState = state;
    await this.ctx.storage.put(HUB_STATE_KEY, state);
  }
}
