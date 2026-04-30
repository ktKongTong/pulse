import { LiveListenDebugPanel } from "@/components/features/status/live-listen/live-listen-debug-panel";

export function meta() {
  return [
    { title: "Live Listen Debug" },
    { name: "description", content: "Sender vs receiver waveform debug" },
  ];
}

export default function LiveListenDebugRoute() {
  return <LiveListenDebugPanel />;
}
