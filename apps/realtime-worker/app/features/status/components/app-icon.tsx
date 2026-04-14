import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { getAppBrandAsset } from "@/lib/brand-assets";

import { iconForApp } from "../lib/status-icons";

export function AppIcon(props: { appId: string; label: string }) {
  const asset = getAppBrandAsset(props.appId);
  const fallback = iconForApp(props.appId, props.label);

  return (
    <Avatar
      size="lg"
      className="size-[60px] rounded-[1.25rem] bg-[#ece6db] text-stone-900 after:hidden"
    >
      {asset ? (
        <AvatarImage
          className="rounded-[1.25rem] object-cover"
          src={asset}
          alt={props.label}
        />
      ) : (
        <AvatarFallback className="rounded-[1.25rem] bg-[#ece6db] text-stone-900">
          {fallback}
        </AvatarFallback>
      )}
    </Avatar>
  );
}
