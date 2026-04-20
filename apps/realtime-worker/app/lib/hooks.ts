import { useTrackPagePresence } from "@pulse/realtime-react";

export {
  useContentHistory,
  useContentLifetime,
  useGlobalPresenceSnapshot,
  useInteractionStates,
  useOwnerHistory,
  useOwnerLifetime,
  useTrackPagePresence,
  usePagePresenceSnapshot,
  usePresenceState,
  useRealtimeDebugState,
  useSiteHistory,
  useSiteLifetime,
  usePulseRealtimeClient,
} from "@pulse/realtime-react";

export function useArticlePresence(article: {
  title: string;
  url: string;
  canonicalUrl: string;
}) {
  useTrackPagePresence(article, { trackReading: true });
}
