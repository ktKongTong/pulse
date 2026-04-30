import { LiveListenHostPanel } from "@/components/features/live-listen-host/live-listen-host-panel";

export function meta() {
  return [
    { title: "Live Listen Host" },
    { name: "description", content: "Pulse Live Listen host publisher" },
  ];
}

export default function LiveListenHostRoute() {
  return <LiveListenHostPanel />;
}
