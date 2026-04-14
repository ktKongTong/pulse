import { Avatar, AvatarFallback } from "@/components/ui/avatar";

function initialsFromName(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("") || "PB"
  );
}

export function StatusHero(props: { deviceName: string }) {
  return (
    <div className="mt-2 flex justify-center">
      <div className="relative">
        <div className="absolute inset-[-24px] rounded-full bg-[radial-gradient(circle,_rgba(0,0,0,0.08),_transparent_68%)] blur-3xl" />
        <Avatar className="relative size-36 bg-[radial-gradient(circle_at_top,_#ffffff,_#ece6db_62%,_#dfd7ca_100%)] shadow-[0_20px_60px_rgba(28,25,23,0.12)] after:hidden md:size-40">
          <AvatarFallback className="bg-transparent text-5xl font-bold tracking-tight text-stone-900 md:text-6xl">
            {initialsFromName(props.deviceName)}
          </AvatarFallback>
        </Avatar>
      </div>
    </div>
  );
}
