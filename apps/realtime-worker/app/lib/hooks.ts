import { usePagePresence } from "@pulse/realtime-react";

export {
  useContentHistory,
  useContentLifetime,
  useGlobalPresenceSnapshot,
  useInteractionStates,
  useOwnerHistory,
  useOwnerLifetime,
  usePagePresence,
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
  usePagePresence(article, { trackReading: true });
}
