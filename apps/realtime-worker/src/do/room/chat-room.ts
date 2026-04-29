import type {
  ChatRoomSnapshot,
  RealtimeChatJoin,
  RealtimeChatLeave,
  RealtimeChatSend,
  RealtimeClientMessage,
  RealtimePresenceContext,
} from "@pulse/realtime-protocol";
import { BaseRoom } from "./base-room";
import type {
  RoomSessionConnectionRecord,
  RoomSessionConnectionState,
} from "../session";
import type { ChatMessageState, ChatParticipantState } from "../../runtime/models";
import * as schema from "../../db/schema";

interface ChatConnectionState extends RoomSessionConnectionState {
  chatMembership?: {
    displayName: string;
    userId?: string;
  };
}

export class ChatRoom extends BaseRoom<ChatConnectionState> {
  private chatParticipants = new Map<string, ChatParticipantState>();
  private chatMessages: ChatMessageState[] = [];
  private typingUsers: Set<string> = new Set();

  protected supportsRoomId(roomId: string): boolean {
    return roomId.startsWith("chat:");
  }

  protected async restoreRoomState(): Promise<void> {
    const storedParticipants = await this.ctx.storage.get<Array<{
      readerId: string;
      displayName: string;
      presenceState: "active";
      updatedAt: string;
      userId?: string;
    }>>("chatParticipants");
    if (storedParticipants) {
      this.chatParticipants = new Map(
        storedParticipants.map((item) => [item.readerId, item]),
      );
    }

    const storedTypingUsers = await this.ctx.storage.get<string[]>("chatTypingUsers");
    if (storedTypingUsers) {
      this.typingUsers = new Set(storedTypingUsers);
    }

    const chatRows = this.db
      .select()
      .from(schema.chatMessages)
      .all()
      .sort((left, right) => left.createdAt - right.createdAt)
      .slice(-50);
    this.chatMessages = chatRows.map((row) => ({
      msgId: row.msgId,
      senderId: row.senderId,
      senderDisplayName: row.senderDisplayName,
      content: row.content,
      createdAt: new Date(row.createdAt).toISOString(),
    }));
  }

  protected async persistRoomState(): Promise<void> {
    if (this.chatParticipants.size > 0) {
      await this.ctx.storage.put(
        "chatParticipants",
        Array.from(this.chatParticipants.values()),
      );
    } else {
      await this.ctx.storage.delete("chatParticipants");
    }

    if (this.typingUsers.size > 0) {
      await this.ctx.storage.put("chatTypingUsers", Array.from(this.typingUsers));
    } else {
      await this.ctx.storage.delete("chatTypingUsers");
    }
  }

  protected async handleRoomAlarm(): Promise<boolean> {
    return false;
  }

  protected buildRoomSnapshot(): ChatRoomSnapshot {
    const participants = Array.from(this.chatParticipants.values()).map(
      (participant) => ({
        readerId: participant.readerId,
        displayName: participant.displayName,
        presenceState: participant.presenceState,
        updatedAt: participant.updatedAt,
      }),
    );

    return {
      roomKind: "chat",
      workspaceId: this.workspaceId,
      roomId: this.roomId,
      revision: Date.now(),
      participantCount: participants.length,
      participants,
      messages: this.chatMessages.map((message) => ({
        msgId: message.msgId,
        senderId: message.senderId,
        senderDisplayName: message.senderDisplayName,
        content: message.content,
        createdAt: message.createdAt,
      })),
      messageCount: this.chatMessages.length,
      typingUsers: Array.from(this.typingUsers),
      updatedAt: new Date().toISOString(),
    };
  }

  protected async handleRoomMessage(
    record: RoomSessionConnectionRecord<ChatConnectionState>,
    message: Exclude<RealtimeClientMessage, { type: "hello" }>,
  ): Promise<void> {
    switch (message.type) {
      case "chat_join":
        return this.handleChatJoinMessage(record, message);
      case "chat_leave":
        return this.handleChatLeaveMessage(record, message);
      case "chat_send":
        return this.handleChatSendMessage(record, message);
      case "presence_context":
        return this.sendUnsupportedRealtimeMessage(record, message);
    }
  }

  protected async handleChatJoinMessage(
    record: RoomSessionConnectionRecord<ChatConnectionState>,
    message: RealtimeChatJoin,
  ): Promise<void> {
    if (message.roomId !== record.state.roomId) {
      this.sendError(
        record.socket,
        record.state.roomId,
        "room_mismatch",
        "chat_join roomId does not match the websocket room.",
      );
      return;
    }

    this.updateConnection(record, {
      ...record.state,
      chatMembership: {
        displayName: message.displayName,
        userId: message.userId,
      },
    });
    await this.joinChat(
      record.state.connectionId,
      message.userId ?? `anon:${record.state.connectionId.slice(0, 8)}`,
      message.displayName,
    );
  }

  protected async handleChatLeaveMessage(
    record: RoomSessionConnectionRecord<ChatConnectionState>,
    message: RealtimeChatLeave,
  ): Promise<void> {
    if (message.roomId !== record.state.roomId) {
      this.sendError(
        record.socket,
        record.state.roomId,
        "room_mismatch",
        "chat_leave roomId does not match the websocket room.",
      );
      return;
    }
    if (!record.state.chatMembership) return;

    this.updateConnection(record, {
      ...record.state,
      chatMembership: undefined,
    });
    await this.leaveChat(record.state.connectionId);
  }

  protected async handleChatSendMessage(
    record: RoomSessionConnectionRecord<ChatConnectionState>,
    message: RealtimeChatSend,
  ): Promise<void> {
    if (message.roomId !== record.state.roomId) {
      this.sendError(
        record.socket,
        record.state.roomId,
        "room_mismatch",
        "chat_send roomId does not match the websocket room.",
      );
      return;
    }
    if (!record.state.chatMembership) {
      this.sendError(
        record.socket,
        record.state.roomId,
        "chat_join_required",
        "Join the room before sending messages.",
      );
      return;
    }
    await this.postChatMessage(
      record.state.connectionId,
      record.state.chatMembership.userId ??
        `anon:${record.state.connectionId.slice(0, 8)}`,
      record.state.chatMembership.displayName,
      message.content,
    );
  }

  protected async cleanupRoomConnection(
    record: RoomSessionConnectionRecord<ChatConnectionState>,
  ): Promise<void> {
    if (!record.state.chatMembership) return;
    await this.leaveChat(record.state.connectionId);
  }

  async webSocketClose(socket: WebSocket): Promise<void> {
    const record = this.findConnectionRecord(socket);
    if (!record) return;

    this.removeConnection(record.state.connectionId);
    if (record.state.chatMembership) {
      await this.leaveChat(record.state.connectionId);
    }
  }

  async webSocketError(socket: WebSocket, error: unknown): Promise<void> {
    const record = this.findConnectionRecord(socket);
    if (!record) return;

    this.sessionLogger.warn("chat room websocket error", {
      roomId: record.state.roomId,
      connectionId: record.state.connectionId,
      error: error instanceof Error ? error.message : String(error),
    });
    this.removeConnection(record.state.connectionId);
    if (record.state.chatMembership) {
      await this.leaveChat(record.state.connectionId);
    }
  }

  private async joinChat(
    sessionDoId: string,
    userId: string,
    displayName: string,
  ) {
    const participant = {
      readerId: sessionDoId,
      displayName,
      presenceState: "active" as const,
      updatedAt: new Date().toISOString(),
      userId,
    };
    this.chatParticipants.set(sessionDoId, participant);
    await this.persistRoomState();
    await this.broadcastCurrentSnapshot();
  }

  private async leaveChat(sessionDoId: string) {
    if (!this.chatParticipants.has(sessionDoId)) return;
    this.chatParticipants.delete(sessionDoId);
    this.typingUsers.delete(sessionDoId);
    await this.persistRoomState();
    await this.broadcastCurrentSnapshot();
  }

  private async postChatMessage(
    sessionDoId: string,
    senderId: string,
    displayName: string,
    content: string,
  ) {
    const nowMs = Date.now();
    const trimmed = content.trim();
    if (!trimmed) return;

    this.chatParticipants.set(sessionDoId, {
      readerId: sessionDoId,
      displayName,
      presenceState: "active",
      updatedAt: new Date(nowMs).toISOString(),
      userId: senderId,
    });
    await this.persistRoomState();

    const msgId = `${nowMs}:${senderId}:${Math.random().toString(36).slice(2, 8)}`;
    this.db
      .insert(schema.chatMessages)
      .values({
        msgId,
        senderId,
        senderDisplayName: displayName,
        content: trimmed,
        createdAt: nowMs,
      })
      .run();

    this.chatMessages = [
      ...this.chatMessages,
      {
        msgId,
        senderId,
        senderDisplayName: displayName,
        content: trimmed,
        createdAt: new Date(nowMs).toISOString(),
      },
    ].slice(-50);

    await this.broadcastCurrentSnapshot();
  }

  private sendUnsupportedRealtimeMessage(
    record: RoomSessionConnectionRecord<ChatConnectionState>,
    _message: RealtimePresenceContext,
  ) {
    this.sendError(
      record.socket,
      record.state.roomId,
      "unsupported_message",
      "This room only supports chat messages.",
    );
  }

  protected async createConnectionState(
    request: Request,
    connectionId: string,
  ): Promise<ChatConnectionState> {
    return this.serializeConnectionState({
      ...(await this.createBaseConnectionState(request, connectionId)),
      chatMembership: undefined,
    });
  }

  protected serializeConnectionState(
    state: ChatConnectionState,
  ): ChatConnectionState {
    return {
      ...this.serializeBaseConnectionState(state),
      chatMembership: state.chatMembership
        ? {
            displayName: state.chatMembership.displayName,
            userId: state.chatMembership.userId,
          }
        : undefined,
    };
  }
}
