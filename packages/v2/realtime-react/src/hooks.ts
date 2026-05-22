import { useEffect, useRef, useSyncExternalStore } from "react";
import type { ClientPageMetadata } from "@pulse/v2-realtime-protocol";
import { usePulseRealtimeV2Client } from "./provider";
import {
  selectActivePages,
  selectGlobalOnlineCount,
  selectGlobalSessionActivity,
  selectGlobalSessionPreview,
  selectOwnerFocus,
  selectPageReaders,
} from "./selectors";
import type { PulseRealtimeV2Snapshot } from "./types";

type Selector<T> = (state: PulseRealtimeV2Snapshot) => T;
type Equality<T> = (left: T, right: T) => boolean;

export function usePulseRealtimeV2State() {
  const client = usePulseRealtimeV2Client();
  return useSyncExternalStore(
    client.subscribe,
    client.getSnapshot,
    client.getSnapshot,
  );
}

export function usePulseRealtimeV2Selector<T>(
  selector: Selector<T>,
  isEqual: Equality<T> = Object.is,
) {
  const client = usePulseRealtimeV2Client();
  const snapshotRef = useRef<T>(selector(client.getSnapshot()));
  const getSelectedSnapshot = () => {
    const next = selector(client.getSnapshot());
    if (!isEqual(snapshotRef.current, next)) snapshotRef.current = next;
    return snapshotRef.current;
  };
  return useSyncExternalStore(
    client.subscribe,
    getSelectedSnapshot,
    getSelectedSnapshot,
  );
}

export function useClientIdentity() {
  return usePulseRealtimeV2Selector((state) => state.identity);
}

export function useCommonSnapshot() {
  return usePulseRealtimeV2Selector((state) => state.common.snapshot);
}

export function useCommonConnection() {
  return usePulseRealtimeV2Selector((state) => state.common.connection);
}

export function useGlobalOnlineCount() {
  return usePulseRealtimeV2Selector(selectGlobalOnlineCount);
}

export function useActivePages() {
  return usePulseRealtimeV2Selector(selectActivePages);
}

export function useOwnerFocus() {
  return usePulseRealtimeV2Selector(selectOwnerFocus);
}

export function useOwnerFocusView() {
  return usePulseRealtimeV2Selector(
    (state) => {
      const focus = selectOwnerFocus(state);
      return {
        focusAppId: focus?.app?.id ?? focus?.app?.name ?? null,
        focusAppLabel: focus?.app?.name ?? focus?.app?.id ?? null,
        online: Boolean(focus),
      };
    },
    shallowEqual,
  );
}

export function useGlobalSessionPreview() {
  return usePulseRealtimeV2Selector(selectGlobalSessionPreview);
}

export function useGlobalSessionActivity() {
  return usePulseRealtimeV2Selector(selectGlobalSessionActivity);
}

export function useClientPage(
  canonicalUrl: string,
  page?: ClientPageMetadata,
) {
  const client = usePulseRealtimeV2Client();
  useEffect(() => {
    void client.connectPage(canonicalUrl, page);
    return () => client.closePage(canonicalUrl);
  }, [client, canonicalUrl, page?.title, page?.url]);

  return usePulseRealtimeV2Selector((state) => state.pages[canonicalUrl] ?? null);
}

export function useClientPageConnection(
  canonicalUrl: string,
  page?: ClientPageMetadata,
) {
  const client = usePulseRealtimeV2Client();
  useEffect(() => {
    void client.connectPage(canonicalUrl, page);
    return () => client.closePage(canonicalUrl);
  }, [client, canonicalUrl, page?.title, page?.url]);
}

export function usePageReaders(canonicalUrl: string) {
  return usePulseRealtimeV2Selector((state) => selectPageReaders(state, canonicalUrl));
}

export function useClientMedia() {
  return usePulseRealtimeV2Selector((state) => state.media);
}

export function useClientMediaConnection() {
  return usePulseRealtimeV2Selector((state) => state.media.connection);
}

export function useClientMediaSource() {
  return usePulseRealtimeV2Selector((state) => state.media.source);
}

export function useClientNowPlaying() {
  return usePulseRealtimeV2Selector((state) => state.media.media);
}

export function useClientMediaDisplayState() {
  return usePulseRealtimeV2Selector(
    (state) => ({
      loading: state.media.connection.status !== "connected",
      media: state.media.media,
    }),
    shallowEqual,
  );
}

export function useClientStreamState() {
  return usePulseRealtimeV2Selector((state) => state.media.stream);
}

export function useClientStreamControlState() {
  return usePulseRealtimeV2Selector(
    (state) => {
      const streaming = state.media.stream.state === "active";
      const streamable = state.media.source.state === "ready";
      return {
        streaming,
        streamable,
        disabled: state.media.stream.state === "requesting" ||
          (!streaming && !streamable),
      };
    },
    shallowEqual,
  );
}

export function useMediaControls() {
  const client = usePulseRealtimeV2Client();
  return {
    connect: () => client.connectMedia(),
    requestStream: () => client.requestStream(),
    stopStream: () => client.stopStream(),
    ackStream: (streamId: string, generation: number, seq: number) =>
      client.ackStream(streamId, generation, seq),
  };
}

export function shallowEqual<T extends object>(left: T, right: T) {
  if (left === right) return true;
  const leftKeys = Object.keys(left) as Array<keyof T>;
  const rightKeys = Object.keys(right) as Array<keyof T>;
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every((key) => Object.is(left[key], right[key]));
}
