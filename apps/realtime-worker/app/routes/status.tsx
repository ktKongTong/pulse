import { useMemo } from "react";
import { StatusAggregateHistory } from "@/components/features/status/status-aggregate-history";
import { StatusHero } from "@/components/features/status/hero";
import {
  useTrackPagePresence,
} from "@pulse/realtime-react";

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
  useTrackPagePresence(pageContext);
  return (
    <main className="min-h-screen  bg-[#f8f3f0] px-6 py-12  text-stone-900 md:px-10">
      <section className="mx-auto relative flex max-w-4xl flex-col space-y-4  items-center">
        <StatusHero />
        <StatusAggregateHistory />
      </section>
    </main>
  );
}
