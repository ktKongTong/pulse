import type {
  DeviceAggregate,
  PageAggregate,
  RoomAggregate,
  StatsSummary,
} from "@pulse/realtime-protocol";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { DeviceFocusChart } from "./device-focus-chart";
import { PageReadingChart } from "./page-reading-chart";
import { RoomActivityChart } from "./room-activity-chart";

interface StatusAggregateTabsProps {
  global: StatsSummary | null;
  device: DeviceAggregate | null;
  pages: PageAggregate[];
  rooms: RoomAggregate[];
}

export function StatusAggregateTabs(props: StatusAggregateTabsProps) {
  const defaultTab = props.device ? "device" : "rooms";

  return (
    <Tabs defaultValue={defaultTab} className="gap-6">
      <TabsList
        variant="line"
        className="w-full justify-start gap-5 border-b border-stone-200/80 p-0 pb-2"
      >
        <TabsTrigger value="device" className="px-0 text-[12px] uppercase tracking-[0.26em]">
          Device
        </TabsTrigger>
        <TabsTrigger value="rooms" className="px-0 text-[12px] uppercase tracking-[0.26em]">
          Rooms
        </TabsTrigger>
        <TabsTrigger value="pages" className="px-0 text-[12px] uppercase tracking-[0.26em]">
          Pages
        </TabsTrigger>
      </TabsList>

      <TabsContent value="device" className="space-y-7">
        <DeviceFocusChart aggregate={props.device} />
      </TabsContent>

      <TabsContent value="rooms" className="space-y-7">
        <RoomActivityChart global={props.global} rooms={props.rooms} />
      </TabsContent>

      <TabsContent value="pages" className="space-y-7">
        <PageReadingChart pages={props.pages} />
      </TabsContent>
    </Tabs>
  );
}
