import type { ClientMediaNowPlaying, DeviceStreamState } from "@pulse/v2-realtime-protocol";
import type { DeviceMediaConnection, MediaStoredState } from "./media";

export function mediaStateEqual(left: MediaStoredState, right: MediaStoredState) {
  return deviceEqual(left.device, right.device) &&
    deviceStreamEqual(left.deviceStreamState, right.deviceStreamState) &&
    mediaEqual(left.currentMedia, right.currentMedia) &&
    left.streamRequestRejectedAt === right.streamRequestRejectedAt;
}

function deviceEqual(
  left: DeviceMediaConnection | null,
  right: DeviceMediaConnection | null,
) {
  if (left === right) return true;
  if (!left || !right) return false;
  return left.connectionId === right.connectionId &&
    left.deviceSessionId === right.deviceSessionId &&
    left.capabilities.streaming === right.capabilities.streaming;
}

function deviceStreamEqual(
  left: DeviceStreamState | null,
  right: DeviceStreamState | null,
) {
  if (left === right) return true;
  if (!left || !right) return false;
  return left.permission === right.permission &&
    left.playback === right.playback &&
    left.capture === right.capture &&
    left.reason === right.reason &&
    left.streamFormat?.codec === right.streamFormat?.codec &&
    left.streamFormat?.sampleRate === right.streamFormat?.sampleRate &&
    left.streamFormat?.channels === right.streamFormat?.channels &&
    left.streamFormat?.bitDepth === right.streamFormat?.bitDepth;
}

function mediaEqual(
  left: ClientMediaNowPlaying | null,
  right: ClientMediaNowPlaying | null,
) {
  if (left === right) return true;
  if (!left || !right) return false;
  return left.playback === right.playback &&
    left.updatedAt === right.updatedAt &&
    left.clock?.mediaProgressSeconds === right.clock?.mediaProgressSeconds &&
    left.clock?.durationSeconds === right.clock?.durationSeconds &&
    left.clock?.updatedAt === right.clock?.updatedAt &&
    left.current.id === right.current.id &&
    left.current.title === right.current.title &&
    left.current.artist === right.current.artist &&
    left.current.album === right.current.album &&
    left.current.artworkUrl === right.current.artworkUrl &&
    left.current.provider === right.current.provider &&
    left.current.providerId === right.current.providerId &&
    left.current.playbackState === right.current.playbackState;
}
