import {
  CLIENT_COMMON_WS_PROTOCOL,
  CLIENT_MEDIA_WS_PROTOCOL,
  CLIENT_PAGE_WS_PROTOCOL,
} from "@ktfun/pulse-protocol";

export type ProtocolKind = "common" | "page" | "media";

export function fatalError(
  kind: ProtocolKind,
  code: string,
  message = code,
) {
  const protocol =
    kind === "common"
      ? CLIENT_COMMON_WS_PROTOCOL
      : kind === "page"
        ? CLIENT_PAGE_WS_PROTOCOL
        : CLIENT_MEDIA_WS_PROTOCOL;
  return {
    protocol,
    type: "error",
    code,
    message,
    fatal: true,
  };
}
