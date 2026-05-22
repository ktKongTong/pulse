import { Avatar, AvatarFallback, AvatarImage } from "../ui/avatar";
import { cn } from "../../lib/utils";

type ProviderBadgeProps = {
  providerId?: string;
  classNames?: { img?: string };
  className?: string;
} & React.ComponentProps<typeof AvatarImage>;

export function ProviderBadge({
  providerId,
  classNames,
  className,
  ...rest
}: ProviderBadgeProps) {
  if (!providerId) return null;
  const assetUrl = resolveProviderAssetUrl(providerId);
  if (!assetUrl) return null;

  return (
    <Avatar className={className}>
      <AvatarImage
        alt={providerId}
        className={cn("size-8 rounded-full object-cover", classNames?.img)}
        src={assetUrl}
        {...rest}
      />
      <AvatarFallback>♪</AvatarFallback>
    </Avatar>
  );
}

function resolveProviderAssetUrl(providerId: string) {
  if (providerId === "spotify") return "/brand-assets/spotify.svg";
  if (providerId === "apple-music") return "/brand-assets/apple-music.svg";
  return null;
}
