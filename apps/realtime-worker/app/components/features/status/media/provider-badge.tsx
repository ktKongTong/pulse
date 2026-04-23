"use memo"
import { resolveDefaultProviderBranding } from "@pulse/realtime-react";

export function ProviderBadge(props: { providerId?: string }) {
  if (!props.providerId) return null;
  const branding = resolveDefaultProviderBranding(props.providerId);
  if (!branding?.assetUrl) return null;
  return (
    <div className="absolute bottom-3 right-3 flex size-10 items-center justify-center rounded-full">
      <img
        className="size-8 rounded-full object-cover"
        src={branding.assetUrl}
        alt={props.providerId}
      />
    </div>
  );
}
