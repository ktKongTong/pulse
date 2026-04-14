import { DurableObject } from "cloudflare:workers";
import {
  DeviceInteractionClientMessageSchema,
  DeviceInteractionDeliverySchema,
  DeviceInteractionHelloAckSchema,
  type DeviceInteractionHello,
  type InteractionState
} from "@pulse/realtime-protocol";

import type { Env } from "./env";

interface StoredInboxState {
  workspaceId: string;
  deviceId: string;
  pending: Record<string, InteractionState>;
  capabilities: DeviceInteractionHello["capabilities"] | null;
}

const INBOX_STATE_KEY = "interaction-inbox-state";

export class InteractionInbox extends DurableObject<Env> {
  private inboxState?: StoredInboxState;

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const state = await this.getState(request);

    switch (url.pathname) {
      case "/api/v1/device-interactions/ws":
      case "/internal/ws":
        return this.handleWebSocket(request);
      case "/internal/enqueue":
        return this.handleEnqueue(request, state);
      default:
        return new Response("Not found", { status: 404 });
    }
  }

  async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const raw = typeof message === "string" ? message : new TextDecoder().decode(message);
    const parsed = DeviceInteractionClientMessageSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      return;
    }

    const state = await this.getState();
    switch (parsed.data.type) {
      case "hello": {
        state.capabilities = parsed.data.capabilities;
        await this.persist(state);
        await this.registerDevice(state, true);
        socket.send(JSON.stringify(DeviceInteractionHelloAckSchema.parse({
          type: "hello_ack",
          selectedProtocol: "interaction.ws.v1"
        })));

        for (const item of Object.values(state.pending)) {
          socket.send(JSON.stringify(DeviceInteractionDeliverySchema.parse({
            type: "command.request",
            request: item
          })));
        }
        return;
      }
      case "command.ack":
      case "command.result": {
        await this.updateHub(parsed.data.requestId, {
          protocol: "interaction.v1",
          requestId: parsed.data.requestId,
          workspaceId: state.workspaceId,
          targetDeviceId: state.deviceId,
          status: parsed.data.status,
          updatedAt: new Date().toISOString(),
          error: parsed.data.type === "command.result" ? parsed.data.error : undefined
        });
        if (parsed.data.type === "command.result" && ["succeeded", "rejected", "failed", "expired"].includes(parsed.data.status)) {
          delete state.pending[parsed.data.requestId];
          await this.persist(state);
        }
        return;
      }
    }
  }

  async webSocketClose(_socket: WebSocket): Promise<void> {
    const state = await this.getState();
    await this.registerDevice(state, false);
  }

  private async handleWebSocket(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected websocket", { status: 426 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  private async handleEnqueue(request: Request, state: StoredInboxState): Promise<Response> {
    const interaction = (await request.json()) as InteractionState;
    state.pending[interaction.requestId] = interaction;
    await this.persist(state);

    for (const socket of this.ctx.getWebSockets()) {
      socket.send(JSON.stringify(DeviceInteractionDeliverySchema.parse({
        type: "command.request",
        request: interaction
      })));
    }

    return Response.json(interaction);
  }

  private async updateHub(requestId: string, patch: Partial<InteractionState>) {
    const current = await this.fetchRequestFromHub(requestId);
    if (!current) return;
    const next = {
      ...current,
      ...patch,
      updatedAt: patch.updatedAt ?? new Date().toISOString()
    };
    await this.hubStub(next.workspaceId).fetch(
      new Request("https://interaction.internal/internal/update-request", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-workspace-id": next.workspaceId
        },
        body: JSON.stringify(next)
      })
    );
  }

  private async fetchRequestFromHub(requestId: string): Promise<InteractionState | null> {
    const state = await this.getState();
    const response = await this.hubStub(state.workspaceId).fetch(
      new Request(`https://interaction.internal/internal/get-request?requestId=${encodeURIComponent(requestId)}`, {
        headers: {
          "x-workspace-id": state.workspaceId
        }
      })
    );
    if (!response.ok) return null;
    return (await response.json()) as InteractionState;
  }

  private hubStub(workspaceId: string) {
    const id = this.env.INTERACTION_HUB.idFromName(workspaceId);
    return this.env.INTERACTION_HUB.get(id);
  }

  private async registerDevice(state: StoredInboxState, connected: boolean) {
    await this.hubStub(state.workspaceId).fetch(
      new Request("https://interaction.internal/internal/register-device", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-workspace-id": state.workspaceId
        },
        body: JSON.stringify({
          deviceId: state.deviceId,
          capabilities: state.capabilities ?? {
            mediaRecommendTrack: false,
            providersSpotify: false,
            providersAppleMusic: false,
            autoEnqueue: false
          },
          connected,
          updatedAt: new Date().toISOString()
        })
      })
    );
  }

  private async getState(request?: Request): Promise<StoredInboxState> {
    if (this.inboxState) return this.inboxState;
    const loaded = await this.ctx.storage.get<StoredInboxState>(INBOX_STATE_KEY);
    const url = request ? new URL(request.url) : null;
    const workspaceId = request?.headers.get("x-workspace-id") ?? url?.searchParams.get("workspaceId") ?? this.env.WORKSPACE_ID;
    const deviceId = request?.headers.get("x-device-id") ?? url?.searchParams.get("deviceId") ?? "unknown-device";
    this.inboxState = loaded ?? {
      workspaceId,
      deviceId,
      pending: {},
      capabilities: null
    };
    return this.inboxState;
  }

  private async persist(state: StoredInboxState) {
    this.inboxState = state;
    await this.ctx.storage.put(INBOX_STATE_KEY, state);
  }
}
