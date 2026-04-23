import { useMemo } from "react";
import { StatusAggregateHistory } from "@/components/features/status/status-aggregate-history";
import { StatusHero } from "@/components/features/status/hero-v1";

import { Separator } from "@/components/ui/separator";
import {
  useGlobalStatus,
  useTrackPagePresence,
} from "@pulse/realtime-react";
import { cn } from "@/lib/utils";

function getStatusPageContext() {
  if (typeof window === "undefined") {
    return {
      title: "Pulse Status",
      url: "/",
      canonicalUrl: "/",
    };
  }

  return {
    title: "Pulse Status",
    url: window.location.href,
    canonicalUrl: `${window.location.origin}/`,
  };
}

export function meta() {
  return [
    { title: "Pulse Status" },
    {
      name: "description",
      content:
        "Minimal realtime status page for current app focus and media playback.",
    },
  ];
}

export default function StatusPage() {
  const pageContext = useMemo(() => getStatusPageContext(), []);
  // refocus reconnect to ws
  useTrackPagePresence(pageContext);

  const { data: globalStatus } = useGlobalStatus();

  return (
    <main className="min-h-screen  bg-[#f8f5ef] px-6 py-12  text-stone-900 md:px-10">
      <section className="mx-auto relative flex max-w-4xl flex-col space-y-4  items-center">
        <div className="absolute right-0 top-0 flex items-center gap-2">
          <div className={cn(
            "size-4 rounded-full",
            "from-green-300/80 via-green-300/60 to-green-100/40 bg-radial bg-clip-content"
          )} />
          <div className="text-xs font-sans">
          {globalStatus?.sessionCount}
          </div>

        </div>

        <StatusHero />
        <StatusAggregateHistory />
      </section>
    </main>
  );
}
