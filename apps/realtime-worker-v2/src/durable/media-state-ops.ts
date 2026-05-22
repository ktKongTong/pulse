import { nowIso } from "../utils/time";
import type { MediaStoredState } from "../state/media";

export function bumpMediaState(state: MediaStoredState) {
  state.revision += 1;
  state.updatedAt = nowIso();
}

export function applyStreamRequestTimeout(state: MediaStoredState) {
  state.streamRequestRejectedAt = nowIso();
}
