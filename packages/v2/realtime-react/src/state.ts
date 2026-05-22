import { createInitialSnapshot } from "./connection";
import type { PulseRealtimeV2Snapshot, StreamRuntimeState } from "./types";

export type Unsubscribe = () => void;

export class RealtimeV2StateStore {
  private state = createInitialSnapshot();
  private listeners = new Set<() => void>();

  getSnapshot = () => this.state;

  subscribe = (listener: () => void): Unsubscribe => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  patch(mutator: (draft: PulseRealtimeV2Snapshot) => void) {
    const draft: PulseRealtimeV2Snapshot = {
      identity: this.state.identity ? { ...this.state.identity } : null,
      common: {
        connection: { ...this.state.common.connection },
        snapshot: this.state.common.snapshot,
      },
      pages: { ...this.state.pages },
      media: {
        connection: { ...this.state.media.connection },
        source: { ...this.state.media.source },
        media: this.state.media.media,
        stream: cloneStreamState(this.state.media.stream),
      },
    };
    mutator(draft);
    const next = preserveReferences(this.state, draft);
    if (next === this.state) return;
    this.state = next;
    this.emit();
  }

  clearListeners() {
    this.listeners.clear();
  }

  private emit() {
    for (const listener of this.listeners) listener();
  }
}

function cloneStreamState(state: StreamRuntimeState): StreamRuntimeState {
  if (state.state === "active") return { ...state };
  if (state.state === "requesting") return { ...state };
  return { state: "observer" };
}

function preserveReferences(
  previous: PulseRealtimeV2Snapshot,
  next: PulseRealtimeV2Snapshot,
) {
  const identity = shallowEqual(previous.identity, next.identity)
    ? previous.identity
    : next.identity;
  const common = shallowEqual(previous.common.connection, next.common.connection) &&
    previous.common.snapshot === next.common.snapshot
    ? previous.common
    : next.common;
  const media = shallowEqual(previous.media.connection, next.media.connection) &&
    shallowEqual(previous.media.source, next.media.source) &&
    previous.media.media === next.media.media &&
    shallowEqual(previous.media.stream, next.media.stream)
    ? previous.media
    : next.media;
  const pages = pagesEqual(previous.pages, next.pages) ? previous.pages : next.pages;

  if (
    identity === previous.identity &&
    common === previous.common &&
    media === previous.media &&
    pages === previous.pages
  ) {
    return previous;
  }

  return { identity, common, pages, media };
}

function pagesEqual(
  left: PulseRealtimeV2Snapshot["pages"],
  right: PulseRealtimeV2Snapshot["pages"],
) {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every((key) => {
    const a = left[key];
    const b = right[key];
    return a === b ||
      Boolean(a && b &&
        shallowEqual(a.connection, b.connection) &&
        a.snapshot === b.snapshot);
  });
}

function shallowEqual(left: object | null, right: object | null) {
  if (left === right) return true;
  if (!left || !right) return false;
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord);
  const rightKeys = Object.keys(rightRecord);
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every((key) => leftRecord[key] === rightRecord[key]);
}
