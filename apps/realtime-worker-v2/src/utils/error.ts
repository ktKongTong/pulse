import {
  CLIENT_PAGE_WS_PROTOCOL,
  CLIENT_WS_PROTOCOL,
} from "@ktfun/pulse-protocol";

export type ProtocolKind = "client" | "page";

export function fatalError(
  kind: ProtocolKind,
  code: string,
  message = code,
) {
  const protocol = kind === "page" ? CLIENT_PAGE_WS_PROTOCOL : CLIENT_WS_PROTOCOL;
  return {
    protocol,
    type: "error",
    code,
    message,
    fatal: true,
  };
}
