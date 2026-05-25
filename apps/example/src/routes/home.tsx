
import { useMemo } from "react";
import { usePagePresence } from "@ktfun/pulse";
import { StatusHero } from "../components/status-hero";

function getStatusPageContext() {
  if (typeof window === "undefined") {
    return { title: "Pulse Status", url: "/", canonicalUrl: "/" };
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

export default function Home() {
  usePagePresence(useMemo(() => getStatusPageContext(), []));
  return (
    <main className="min-h-screen bg-[#f8f3f0] text-stone-900 md:flex items-center">
      <section className="mx-auto w-full relative flex max-w-4xl flex-col items-center">
        <StatusHero />
      </section>
    </main>
  );
}
