import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";

import { MessageCircleMore, X } from "lucide-react";

import { useChatRoom, usePulseRealtimeClient } from "@pulse/realtime-react";
import { getOrCreateSessionId } from "@pulse/realtime-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

export function ChatRoomPanel(props: {
  roomId: string;
  title?: string;
  subtitle?: string;
  participantName?: string;
}) {
  const client = usePulseRealtimeClient();
  const participantName = useMemo(() => {
    if (props.participantName?.trim()) return props.participantName.trim();
    const explicitUserId = client.config.interactionActor?.userId?.trim();
    if (explicitUserId) return explicitUserId;
    const sessionId = getOrCreateSessionId(client.config);
    return `Anonymous ${sessionId.slice(0, 6)}`;
  }, [client.config, props.participantName]);

  const { snapshot, error, sendMessage } = useChatRoom({
    roomId: props.roomId,
    displayName: participantName,
    userId: client.config.interactionActor?.userId,
  });

  const [draft, setDraft] = useState("");
  const [open, setOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = "0px";
    element.style.height = `${Math.min(Math.max(element.scrollHeight, 42), 132)}px`;
  }, [draft]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown as unknown as EventListener);
    return () =>
      window.removeEventListener(
        "keydown",
        handleKeyDown as unknown as EventListener,
      );
  }, [open]);

  const messages = snapshot?.messages ?? [];
  const participants = snapshot?.participants ?? [];
  const duplicateNameCounts = participants.reduce<Record<string, number>>(
    (acc, participant) => {
      acc[participant.displayName] = (acc[participant.displayName] ?? 0) + 1;
      return acc;
    },
    {},
  );

  const submitDraft = () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    sendMessage(trimmed);
    setDraft("");
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    submitDraft();
  };

  const handleComposerKeyDown = (
    event: KeyboardEvent<HTMLTextAreaElement>,
  ) => {
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    submitDraft();
  };

  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-50 sm:right-6 sm:bottom-6">
      {open ? (
        <section className="pointer-events-auto w-[min(26rem,calc(100vw-2rem))] overflow-hidden rounded-[2rem] border border-white/70 bg-[rgba(248,245,239,0.94)] shadow-[0_28px_90px_rgba(28,25,23,0.16)] backdrop-blur-xl">
          <div className="border-b border-stone-300/70 px-5 py-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[10px] font-medium uppercase tracking-[0.32em] text-stone-400">
                  {props.title ?? "Chat room"}
                </p>
                <h2 className="mt-2 text-[18px] font-medium tracking-tight text-stone-950">
                  {props.subtitle ?? "Realtime chat"}
                </h2>
              </div>
              <button
                className="inline-flex size-9 items-center justify-center rounded-full border border-stone-200 bg-white/70 text-stone-500 transition hover:border-stone-300 hover:text-stone-950"
                onClick={() => setOpen(false)}
                type="button"
              >
                <X className="size-4" />
              </button>
            </div>

            <div className="mt-4 flex items-center justify-between gap-4 text-[11px] uppercase tracking-[0.24em] text-stone-400">
              <span>{participants.length} online</span>
              <div className="flex items-center gap-2">
                <ChatAvatar name={participantName} size="sm" inverted />
                <span>{participantName}</span>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              {participants.slice(0, 8).map((participant) => {
                const isSelf = participant.displayName === participantName;
                const isDuplicateName =
                  (duplicateNameCounts[participant.displayName] ?? 0) > 1;
                return (
                  <div
                    key={participant.readerId}
                    className="inline-flex items-center gap-2 rounded-full border border-stone-200 bg-white/80 px-2.5 py-1.5 text-stone-700"
                  >
                    <ChatAvatar
                      name={participant.displayName}
                      size="sm"
                      inverted={isSelf}
                    />
                    <span className="max-w-[7rem] truncate text-[12px] font-medium">
                      {isSelf ? "You" : participant.displayName}
                    </span>
                    {isDuplicateName ? (
                      <span className="text-[10px] uppercase tracking-[0.16em] text-stone-400">
                        {participant.readerId.slice(-4)}
                      </span>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="px-4 py-4">
            <div className="max-h-[min(44vh,24rem)] space-y-2 overflow-y-auto pr-1">
              {messages.length === 0 ? (
                <div className="flex min-h-[180px] items-center justify-center rounded-[1.5rem] border border-dashed border-stone-300/80 bg-white/60 px-6 text-center">
                  <p className="max-w-sm text-[14px] leading-7 text-stone-500">
                    No messages yet. Open the room and say something.
                  </p>
                </div>
              ) : (
                messages.map((message) => {
                  const isSelf = message.senderDisplayName === participantName;
                  const isDuplicateName =
                    (duplicateNameCounts[message.senderDisplayName] ?? 0) > 1;
                  return (
                    <article
                      key={message.msgId}
                      className={`rounded-[1.35rem] border px-4 py-3 ${
                        isSelf
                          ? "border-stone-900/10 bg-[#f7f1e8]"
                          : "border-stone-200/80 bg-white/70"
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <ChatAvatar
                          name={message.senderDisplayName}
                          size="default"
                          inverted={isSelf}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-4">
                            <div className="flex min-w-0 items-center gap-2">
                              <span className="text-[11px] font-medium uppercase tracking-[0.22em] text-stone-400">
                                {isSelf ? "You" : message.senderDisplayName}
                              </span>
                              {isDuplicateName ? (
                                <span className="text-[10px] uppercase tracking-[0.16em] text-stone-300">
                                  {message.senderId.slice(-4)}
                                </span>
                              ) : null}
                            </div>
                            <span className="shrink-0 pt-0.5 text-[11px] uppercase tracking-[0.22em] text-stone-400">
                              {formatChatTimestamp(message.createdAt)}
                            </span>
                          </div>
                          <p className="mt-2 whitespace-pre-wrap text-[15px] leading-7 text-stone-700">
                            {message.content}
                          </p>
                        </div>
                      </div>
                    </article>
                  );
                })
              )}
            </div>

            <form className="mt-4 space-y-3" onSubmit={handleSubmit}>
              <div className="rounded-[1.45rem] border border-stone-200/80 bg-white/75 p-3 shadow-[0_10px_30px_rgba(28,25,23,0.05)]">
                <div className="flex items-end gap-3">
                  <ChatAvatar name={participantName} size="default" inverted />
                  <textarea
                    ref={textareaRef}
                    className="min-h-[42px] flex-1 resize-none bg-transparent px-1 py-1 text-[15px] leading-7 text-stone-950 outline-none placeholder:text-stone-400"
                    value={draft}
                    onChange={(event) => setDraft(event.currentTarget.value)}
                    onKeyDown={handleComposerKeyDown}
                    placeholder="Message the room..."
                    rows={1}
                  />
                  <button
                    className="inline-flex h-10 shrink-0 items-center justify-center rounded-full bg-stone-900 px-4 text-[11px] font-medium uppercase tracking-[0.22em] text-stone-50 transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:opacity-40"
                    disabled={!draft.trim()}
                    type="submit"
                  >
                    Send
                  </button>
                </div>

                <div className="mt-3 flex items-center justify-between gap-4 border-t border-stone-200/80 pt-3 text-[11px] text-stone-400">
                  <span>Enter sends.</span>
                  <span>Shift+Enter adds a line.</span>
                </div>
              </div>
            </form>

            {error ? (
              <p className="mt-3 text-[13px] font-medium text-rose-600">
                {error}
              </p>
            ) : null}
          </div>
        </section>
      ) : null}

      <button
        className={`pointer-events-auto ml-auto flex items-center gap-3 rounded-full border border-stone-200/80 bg-[rgba(248,245,239,0.92)] px-4 py-3 text-stone-950 shadow-[0_20px_50px_rgba(28,25,23,0.16)] backdrop-blur-xl transition hover:-translate-y-0.5 hover:shadow-[0_24px_60px_rgba(28,25,23,0.18)] ${
          open ? "mt-3" : ""
        }`}
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <div className="relative flex size-11 items-center justify-center rounded-full bg-stone-900 text-stone-50">
          <MessageCircleMore className="size-5" />
          {messages.length > 0 ? (
            <span className="absolute -top-1 -right-1 inline-flex min-w-5 items-center justify-center rounded-full bg-amber-200 px-1.5 text-[10px] font-semibold text-stone-900">
              {Math.min(messages.length, 99)}
            </span>
          ) : null}
        </div>
        <div className="text-left">
          <p className="text-[10px] font-medium uppercase tracking-[0.24em] text-stone-400">
            {props.title ?? "Chat room"}
          </p>
          <p className="mt-1 text-[14px] font-medium tracking-tight text-stone-950">
            {open ? "Hide chat" : "Open chat"}
          </p>
        </div>
      </button>
    </div>
  );
}

function formatChatTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function initialsFromName(value: string) {
  return (
    value
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("") || "?"
  );
}

function ChatAvatar(props: {
  name: string;
  size: "sm" | "default";
  inverted?: boolean;
}) {
  const tone = avatarToneClass(props.name);
  return (
    <Avatar
      size={props.size === "sm" ? "sm" : "default"}
      className={
        props.inverted
          ? "bg-stone-900 after:border-stone-900/20"
          : `${tone.root} after:border-stone-300/70`
      }
    >
      <AvatarFallback
        className={
          props.inverted
            ? "bg-stone-900 text-stone-50"
            : `${tone.fallback}`
        }
      >
        {initialsFromName(props.name)}
      </AvatarFallback>
    </Avatar>
  );
}

function avatarToneClass(name: string) {
  const tones = [
    { root: "bg-amber-100", fallback: "bg-amber-100 text-amber-900" },
    { root: "bg-emerald-100", fallback: "bg-emerald-100 text-emerald-900" },
    { root: "bg-sky-100", fallback: "bg-sky-100 text-sky-900" },
    { root: "bg-rose-100", fallback: "bg-rose-100 text-rose-900" },
    { root: "bg-violet-100", fallback: "bg-violet-100 text-violet-900" },
    { root: "bg-stone-200", fallback: "bg-stone-200 text-stone-700" },
  ];
  const hash = Array.from(name).reduce(
    (sum, character) => sum + character.charCodeAt(0),
    0,
  );
  return tones[hash % tones.length]!;
}
