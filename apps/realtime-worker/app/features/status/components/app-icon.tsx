import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { resolveDefaultAppBranding } from "@pulse/realtime-react";

export function AppIcon(props: { appId: string; label: string }) {
  const branding = resolveDefaultAppBranding(props.appId, props.label);

  return (
    <Avatar
      size="lg"
      aria-label={props.label}
      className="size-[60px] rounded-[1.25rem] bg-[#ece6db] after:hidden"
    >
      {branding.assetUrl ? (
        <AvatarImage
          className="rounded-[1.25rem] object-cover"
          src={branding.assetUrl}
          alt={props.label}
        />
      ) : null}
      <AvatarFallback className="rounded-[1.25rem] bg-[#ece6db] text-stone-900">
        {initial(props.label)}
      </AvatarFallback>
    </Avatar>
  );
}

function initial(label: string) {
  return label.trim()[0]?.toUpperCase() ?? "?";
}
