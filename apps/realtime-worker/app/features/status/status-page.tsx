import { useEffect, useMemo, useState } from "react";

import { ChatRoomPanel } from "@/components/chat-room-panel";
import { Separator } from "@/components/ui/separator";
import {
  useGlobalPresenceSnapshot,
  usePagePresence,
  useStatusAggregates,
} from "@pulse/realtime-react";

import { FocusSwitcher } from "./components/focus-switcher";
import { MediaState } from "./components/media-state";
import { StatusAggregateHistory } from "./components/status-aggregate-history";
import { StatusAggregates } from "./components/status-aggregates";
import { StatusHero } from "./components/status-hero";
import { buildStatusViewModel } from "./lib/status-model";

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
  usePagePresence(pageContext);
  const now = useNowTick();

  const { snapshot } = useGlobalPresenceSnapshot();
  const viewModel = buildStatusViewModel(snapshot, now);
  const aggregates = useStatusAggregates(viewModel.deviceId);

  return (
    <main className="min-h-screen bg-[#f8f5ef] px-6 py-12 text-stone-900 md:px-10">
      <section className="mx-auto flex max-w-4xl flex-col items-center">
        <div className="w-full max-w-2xl pt-6 text-center md:pt-12">
          <StatusHero deviceName={viewModel.deviceName} />

          <div className="mt-10">
            <FocusSwitcher
              appId={viewModel.appId}
              appLabel={viewModel.appLabel}
            />
          </div>

          <Separator className="mx-auto mt-16 w-16 bg-stone-300/80" />

          <div className="mx-auto mt-12 max-w-2xl text-left">
            <MediaState media={viewModel.media} />
          </div>
        </div>

        <div className="mt-16 w-full max-w-3xl">
          <Separator className="bg-stone-200/80" />
          <div className="pt-10">
            <StatusAggregates
              day={aggregates.day}
              global={aggregates.global}
              device={aggregates.device}
              pages={aggregates.pages}
              rooms={aggregates.rooms}
              loading={aggregates.loading}
              error={aggregates.error}
            />
          </div>
        </div>

        <div className="mt-16 w-full max-w-3xl">
          <Separator className="bg-stone-200/80" />
          <div className="pt-10">
            <StatusAggregateHistory deviceId={viewModel.deviceId} />
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

function useNowTick(intervalMs = 120) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);

  return now;
}
