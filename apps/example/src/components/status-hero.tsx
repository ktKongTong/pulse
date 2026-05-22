import {
  useCommonConnection,
  useOwnerFocusView,
} from "@pulse/v2-realtime-react";
import { FocusSwitcher } from "./focus/focus-switcher";
import { MediaState } from "./media/media-state";

export function StatusHero() {
  const { loading, focusAppId, focusAppLabel, isOnline } = useHeroCommonState();

  return (
    <div className="flex flex-col gap-6 max-w-5xl items-center text-center w-full px-4 sm:px-6 md:px-10 pt-10 pb-6">
      <div className="relative w-full">
        {isOnline && (
          <div className="absolute flex items-center gap-2 font-medium left-2 text-emerald-500 top-1 uppercase tracking-wide">
            <div className="size-2 rounded-full bg-emerald-400" />
            <span className="text-sm">LIVE ONLINE</span>
          </div>
        )}

        <div className="flex flex-col items-start absolute left-2 -bottom-2 z-10">
          <div className="font-serif text-start sm:text-5xl sm:-translate-y-8 font-medium text-2xl">
            Hi, I'm KT.
          </div>
          <div className="font-serif text-start sm:-translate-y-6 font-medium text-md">
            想要理解
            <br />
            这荒诞而迷人的世界
          </div>
          {loading ? (
            <Skeleton className="my-2 h-8 w-50 rounded-full" />
          ) : focusAppId && focusAppLabel ? (
            <FocusSwitcher
              appId={focusAppId}
              appLabel={focusAppLabel}
              className="my-2 h-8 w-50"
            />
          ) : null}
          <MediaState className="hidden md:block" />
        </div>

        <img alt="KT avatar" className="ml-auto shrink-0 max-h-[360px] w-fit aspect-auto" src="/avatar.png" />
      </div>

      <MediaState className="md:hidden w-full overflow-visible" />
    </div>
  );
}

function Skeleton(props: { className?: string }) {
  return <div className={`animate-pulse bg-amber-50/70 ${props.className ?? ""}`} />;
}

function useHeroCommonState() {
  const commonConnection = useCommonConnection();
  const focus = useOwnerFocusView();
  const loading = !focus.online && commonConnection.status !== "error";
  return {
    loading,
    focusAppId: focus.focusAppId,
    focusAppLabel: focus.focusAppLabel,
    isOnline: !loading && focus.online,
  };
}
