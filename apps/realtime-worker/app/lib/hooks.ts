import { usePagePresence } from "@pulse/realtime-react";

export {
  useGlobalPresenceSnapshot,
  useInteractionStates,
  usePagePresence,
  usePagePresenceSnapshot,
  usePresenceState,
  useRealtimeDebugState,
  useRoomSnapshot,
  useStatusAggregates,
  usePulseRealtimeClient,
} from "@pulse/realtime-react";

export function useArticlePresence(article: {
  title: string;
  url: string;
  canonicalUrl: string;
}) {
  usePagePresence(article, { trackReading: true });
}
