import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { resolveAppIconAssetUrl } from "@/lib/app-icon";

export function AppIcon(props: { appId: string; label: string }) {
  const assetUrl = resolveAppIconAssetUrl(props.appId);

  return (
    <Avatar
      size="default"
      aria-label={props.label}
      className="rounded-none size-6 after:hidden"
    >
      {assetUrl ? (
        <AvatarImage className="rounded-none" src={assetUrl} alt={props.label} />
      ) : null}
      <AvatarFallback className="text-stone-900">{initial(props.label)}</AvatarFallback>
    </Avatar>
  );
}

function initial(label: string) {
  return label.trim()[0]?.toUpperCase() ?? "?";
}
