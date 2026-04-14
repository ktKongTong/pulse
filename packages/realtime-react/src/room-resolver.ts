export type PresenceSubscriptionIntent =
  | {
      capability: "presence";
      scope: "site";
      subject: "global";
    }
  | {
      capability: "presence";
      scope: "page";
      canonicalUrl: string;
    };

export function resolveRoomId(intent: PresenceSubscriptionIntent): string {
  if (intent.scope === "site") {
    return "global";
  }

  return `page:${intent.canonicalUrl}`;
}

export function presenceSubscriptionKey(intent: PresenceSubscriptionIntent): string {
  if (intent.scope === "site") {
    return "presence:site:global";
  }

  return `presence:page:${intent.canonicalUrl}`;
}
