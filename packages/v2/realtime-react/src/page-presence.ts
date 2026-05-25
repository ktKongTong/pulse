'use client'
import {useCallback, useEffect, useRef} from "react";
import type { ClientPageMetadata } from "@ktfun/pulse-protocol";
import { usePulseRealtimeV2Client } from "./provider";
import { useClientPageConnection } from "./hooks";

export type PagePresenceParams = ClientPageMetadata & {
  canonicalUrl: string;
};

export type PagePresenceOptions = {
  getScrollY?: () => number;
  getScrollableHeight?: () => number;
  getCurrentUrl?: () => string;
};

export function usePagePresence(
  page: PagePresenceParams,
  options: PagePresenceOptions = {},
) {
  const client = usePulseRealtimeV2Client();
  const seq = useRef(1);
  const lastPublished = useRef<PagePresenceSnapshot | null>(null);
  const getScrollY = options.getScrollY ?? defaultScrollY;
  const getScrollableHeight = options.getScrollableHeight ?? defaultScrollableHeight;
  const getCurrentUrl = options.getCurrentUrl ?? defaultCurrentUrl;

  useClientPageConnection(page.canonicalUrl, {
    title: page.title,
    url: page.url,
  });

  const publish = () => {
    const scrollY = getScrollY();
    const scrollable = Math.max(1, getScrollableHeight());
    const percent = Math.min(100, Math.round((scrollY / scrollable) * 100));
    const snapshot = {
      title: page.title,
      url: getCurrentUrl(),
      percent,
      scrollY: Math.round(scrollY),
    };
    if (pagePresenceSnapshotEqual(lastPublished.current, snapshot)) return;
    lastPublished.current = snapshot;
    client.updatePage(page.canonicalUrl, {
      seq: seq.current,
      reading: { percent: snapshot.percent, scrollY: snapshot.scrollY },
      page: { title: snapshot.title, url: snapshot.url },
    });
    seq.current += 1;
  };
  const throttledPublish = useThrottleFn(publish, 500)
  useEffect(() => {
    window.addEventListener("scroll", throttledPublish, { passive: true });
    return () => {
      window.removeEventListener("scroll", throttledPublish);
    };
  }, [ throttledPublish ]);
}

type PagePresenceSnapshot = {
  title?: string;
  url?: string;
  percent: number;
  scrollY: number;
};

function pagePresenceSnapshotEqual(
  left: PagePresenceSnapshot | null,
  right: PagePresenceSnapshot,
) {
  if (!left) return false;
  return (
    left.title === right.title &&
    left.url === right.url &&
    left.percent === right.percent &&
    left.scrollY === right.scrollY
  );
}

function defaultScrollY() {
  return window.scrollY;
}

function defaultScrollableHeight() {
  return document.documentElement.scrollHeight - window.innerHeight;
}

function defaultCurrentUrl() {
  return window.location.href;
}

type AnyFunction = (...args: any[]) => any;
export function useThrottleFn<T extends AnyFunction>(
  fn: T,
  delay: number = 200
): (...args: Parameters<T>) => ReturnType<T> | undefined {
  const lastCall = useRef<number>(0);
  const fnRef = useRef<T>(fn);
  fnRef.current = fn;

  return useCallback(
    (...args: Parameters<T>): ReturnType<T> | undefined => {
      const now = Date.now();
      if (now - lastCall.current >= delay) {
        lastCall.current = now;
        return fnRef.current(...args);
      }
      return undefined;
    },
    [delay]
  );
}