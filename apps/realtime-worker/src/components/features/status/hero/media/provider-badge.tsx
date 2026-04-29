"use memo"
import { resolveDefaultProviderBranding } from "@pulse/realtime-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

type ProviderBadgeProps = {
  providerId?: string,

  classNames?: {
    img?: string

  }
  className?: string
} & React.ComponentProps<typeof AvatarImage>

export function ProviderBadge({ providerId, classNames, className, ...rest }: ProviderBadgeProps) {
  if (!providerId) return null;
  const branding = resolveDefaultProviderBranding(providerId);
  if (!branding?.assetUrl) return null;
  return (
    <Avatar className={className}>
      <AvatarImage
        alt={providerId}
        className={cn(
          "size-8 rounded-full object-cover",
          classNames?.img
        )}
        src={branding.assetUrl}
        {...rest}
      />
      <AvatarFallback>
        ♪
       </AvatarFallback>
    </Avatar>
  );
}
