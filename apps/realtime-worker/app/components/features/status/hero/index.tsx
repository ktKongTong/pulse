import { FocusSwitcher } from "@/components/features/status/hero/focus/focus-switcher";
import { MediaState } from "./media/media-v2";
import { useOwnerStatus } from "@pulse/realtime-react";

export function StatusHero() {
  const { data: ownerStatus } = useOwnerStatus();
  const currentAppId = ownerStatus?.focus?.id ?? 'idle'
  const currentAppLabel = ownerStatus?.focus?.name ?? 'Idle';
  return (
    <div className="flex flex-col gap-6 max-w-5xl items-center text-center w-full px-4 sm:px-6 md:px-10 pt-10 pb-6">
      <div className="relative w-full">
        <div className="absolute flex items-center gap-2  font-medium left-2 text-emerald-500 top-1 uppercase tracking-wide">
          <div className="size-2 rounded-full bg-emerald-400"></div>
          <span className="text-sm">LIVE ONLINE</span>
        </div>
        <div className="flex flex-col items-start absolute left-2 -bottom-2 z-10">

          <div className="font-serif text-start sm:text-5xl sm:-translate-y-8 font-medium text-2xl">
            Hi, I'm KT.
          </div>
          <div className="font-serif text-start sm:-translate-y-6 font-medium text-md">
            想要理解
            <br/>这荒诞而迷人的世界
          </div>
          <FocusSwitcher className="my-2 h-8 w-50" appId={currentAppId} appLabel={currentAppLabel} />

          <MediaState className="hidden md:block" />
        </div>
        <img src="/avatar.png"
        className="ml-auto shrink-0 max-h-[360px] w-fit aspect-auto"
        />
        {/*<Avatar className="rounded-none ml-auto border-none min-w-fit after:hidden">
          <AvatarImage
            src={"/public/avatar.png"}
            className={
              "rounded-none border-none aspect-auto max-w-[320px] h-[240px] sm:max-w-full sm:w-full sm:h-[380px]  object-contain"
            } alt={deviceName} />
          <AvatarFallback className="bg-transparent  text-5xl border-none font-bold tracking-tight text-stone-900 md:text-6xl">
            {'KT'}
          </AvatarFallback>
        </Avatar>*/}
      </div>

      <MediaState className="md:hidden w-full overflow-visible" />
    </div>

  );
}
