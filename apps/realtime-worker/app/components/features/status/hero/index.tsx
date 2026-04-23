import { FocusSwitcher } from "@/components/features/status/hero/focus/focus-switcher";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { MediaState } from "./media/media-state";
import { useOwnerStatus } from "@pulse/realtime-react";

function initialsFromName(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("") || "PB"
  );
}

export function StatusHero() {
  const { data: ownerStatus } = useOwnerStatus();
  const currentAppId = ownerStatus?.focus?.id ?? 'idle'
  const currentAppLabel = ownerStatus?.focus?.name ?? 'Idle';
  const deviceName = currentAppLabel
  return (
    <div  className="flex flex-col items-center text-center w-full">
      <Avatar className="relative size-48 md:size-60 rounded-none border-none after:hidden">
        <AvatarImage src={"https://s3.ktlab.io/avatar.png"} className={"rounded-none border-none"} alt={deviceName} />
        <AvatarFallback className="bg-transparent text-5xl border-none font-bold tracking-tight text-stone-900 md:text-6xl">
          {'KT'}
        </AvatarFallback>
      </Avatar>
      <FocusSwitcher className="my-12 h-8" appId={currentAppId} appLabel={currentAppLabel} />
      <MediaState />
    </div>

  );
}
