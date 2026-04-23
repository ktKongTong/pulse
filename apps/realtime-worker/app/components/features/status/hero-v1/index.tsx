import { FocusSwitcher } from "@/components/focus-switcher";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { MediaState } from "../media-state";
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
      <Avatar className="relative size-48 md:size-60">
        <AvatarImage src={"https://i.pinimg.com/1200x/fe/fe/f4/fefef443ac0195b4bb570edef0b588d0.jpg"} alt={deviceName} />
        <AvatarFallback className="bg-transparent text-5xl font-bold tracking-tight text-stone-900 md:text-6xl">
          {'KT'}
        </AvatarFallback>
      </Avatar>
      <FocusSwitcher className="my-12 h-8" appId={currentAppId} appLabel={currentAppLabel} />
      <MediaState />
    </div>

  );
}
