import { useEffect, useMemo, useState } from "react";

import { ChatRoomPanel } from "@/components/chat-room-panel";
import { Separator } from "@/components/ui/separator";
import {
  useGlobalStatus,
  useOwnerMedia,
  useOwnerStatus,
  useTrackPagePresence,
} from "@pulse/realtime-react";

import { FocusSwitcher } from "./components/focus-switcher";
import { MediaState } from "./components/media-state";
import { StatusAggregateHistory } from "./components/status-aggregate-history";
import { StatusAggregates } from "./components/status-aggregates";
import { StatusHero } from "./components/status-hero";

function getStatusPageContext() {
  if (typeof window === "undefined") {
    return {
      title: "Pulse Status",
      url: "/status",
      canonicalUrl: "/status",
    };
  }

  return {
    title: "Pulse Status",
    url: window.location.href,
    canonicalUrl: `${window.location.origin}/status`,
  };
}

export function statusMeta() {
  return [
    { title: "Pulse Status" },
    {
      name: "description",
      content:
        "Minimal realtime status page for current app focus and media playback.",
    },
  ];
}

export function StatusPage() {
  const pageContext = useMemo(() => getStatusPageContext(), []);
  const chatRoomId = useMemo(() => "chat:status", []);
  useTrackPagePresence(pageContext);
  const { data: globalStatus } = useGlobalStatus();
  const { data: ownerStatus } = useOwnerStatus();

  const focus = ownerStatus?.focus;
  const activePages = globalStatus?.activePages ?? [];
  const onlineCount = globalStatus?.sessionCount ?? 0;
  const currentAppId = focus?.id ?? "idle";
  const currentAppLabel = focus?.name ?? "Idle";

  return (
    <main className="min-h-screen bg-[#f8f5ef] px-6 py-12 text-stone-900 md:px-10">
      <section className="mx-auto flex max-w-4xl flex-col items-center">
        <div className="w-full max-w-2xl pt-6 text-center md:pt-12">
          <StatusHero deviceName={currentAppLabel} />

          <div className="mt-10">
            <FocusSwitcher appId={currentAppId} appLabel={currentAppLabel} />
          </div>

          <Separator className="mx-auto mt-16 w-16 bg-stone-300/80" />

          <div className="mx-auto mt-12 max-w-2xl text-left">
            <MediaState />
          </div>
        </div>

        <div className="mt-16 w-full max-w-3xl">
          <Separator className="bg-stone-200/80" />
          <div className="pt-10">
            <StatusAggregates
              activePages={activePages}
              currentAppLabel={currentAppLabel}
              onlineCount={onlineCount}
            />
          </div>
        </div>

        <div className="mt-16 w-full max-w-3xl">
          <Separator className="bg-stone-200/80" />
          <div className="pt-10">
            <StatusAggregateHistory />
          </div>
        </div>
      </section>
      <ChatRoomPanel
        roomId={chatRoomId}
        title="Status chat"
        subtitle="Everyone on the status page joins the same chat room automatically."
      />
    </main>
  );
}
