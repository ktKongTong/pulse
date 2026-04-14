import { getProviderBrandAsset } from "@/lib/brand-assets";

import { providerBadgeFallback } from "../lib/status-icons";

export function ProviderBadge(props: { providerId?: string }) {
  if (!props.providerId) return null;

  const asset = getProviderBrandAsset(props.providerId);

  return (
    <div className="absolute bottom-3 right-3 flex size-10 items-center justify-center rounded-full bg-white/95 shadow-[0_8px_22px_rgba(28,25,23,0.18)]">
      {asset ? (
        <img
          className="size-8 rounded-full object-cover"
          src={asset}
          alt={props.providerId}
        />
      ) : (
        providerBadgeFallback(props.providerId)
      )}
    </div>
  );
}
