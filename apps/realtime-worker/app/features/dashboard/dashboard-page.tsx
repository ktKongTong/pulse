import { Link } from "react-router";
import { useMemo } from "react";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LiveMediaPanel } from "@/components/live-media-panel";
import { RealtimeObservabilityPanel } from "@/components/realtime-observability-panel";
import { articles } from "@/lib/articles";
import {
  useGlobalPresenceSnapshot,
  useInteractionStates,
  usePagePresence,
  useRealtimeDebugState,
} from "@pulse/realtime-react";

function getDashboardContext() {
  if (typeof window === "undefined") {
    return {
      title: "Pulse Dashboard",
      url: "/dashboard",
      canonicalUrl: "/dashboard",
    };
  }

  return {
    title: "Pulse Dashboard",
    url: window.location.href,
    canonicalUrl: `${window.location.origin}/dashboard`,
  };
}

export function dashboardMeta() {
  return [
    { title: "Pulse Dashboard" },
    {
      name: "description",
      content:
        "Dashboard for current room state, readers, media, and realtime transport health.",
    },
  ];
}

export function DashboardPage() {
  const pageContext = useMemo(() => getDashboardContext(), []);
  usePagePresence(pageContext);

  const debug = useRealtimeDebugState();
  const { snapshot } = useGlobalPresenceSnapshot();
  const { items: interactionStates } = useInteractionStates();

  const readers = snapshot?.activeReaders ?? [];
  const webReaders = readers.filter((reader) => reader.source === "web");
  const deviceReaders = readers.filter((reader) => reader.source === "device");
  const activePages = Object.entries(snapshot?.pageConcurrencyMap ?? {})
    .map(([canonicalUrl, count]) => ({
      canonicalUrl,
      title:
        readers.find((reader) => reader.page?.canonicalUrl === canonicalUrl)?.page
          ?.title ?? canonicalUrl,
      count,
    }))
    .sort((left, right) => right.count - left.count);

  return (
    <main className="min-h-screen bg-background px-6 py-10 text-foreground md:px-10">
      <section className="mx-auto flex max-w-7xl flex-col gap-8">
        <header className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-3">
            <p className="text-[0.72rem] font-semibold uppercase tracking-[0.32em] text-muted-foreground">
              Pulse rooms
            </p>
            <h1 className="font-display text-5xl font-bold tracking-tight md:text-6xl">
              Dashboard
            </h1>
            <p className="max-w-3xl text-sm leading-7 text-muted-foreground md:text-base">
              A single surface for the current state of the global room, active
              page rooms, connected devices, and realtime transport.
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <Link
              className="inline-flex items-center justify-center rounded-full bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground"
              to="/status"
            >
              Open status
            </Link>
            {articles.map((article) => (
              <Link
                key={article.slug}
                className="inline-flex items-center justify-center rounded-full bg-secondary px-4 py-2.5 text-sm font-medium text-secondary-foreground"
                to={`/article/${article.slug}`}
              >
                {article.title}
              </Link>
            ))}
          </div>
        </header>

        <div className="grid gap-4 md:grid-cols-4">
          <SummaryCard
            title="Global room"
            value={`${snapshot?.onlineCount ?? 0}`}
            subtitle="Total live readers and devices."
          />
          <SummaryCard
            title="Web readers"
            value={`${webReaders.length}`}
            subtitle="Browser sessions currently online."
          />
          <SummaryCard
            title="Devices"
            value={`${deviceReaders.length}`}
            subtitle="Foreground PulseBar devices."
          />
          <SummaryCard
            title="Interactions"
            value={`${interactionStates.length}`}
            subtitle="Recent interaction requests."
          />
        </div>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_420px]">
          <div className="space-y-6">
            <Card className="rounded-[1.75rem] border border-border/70 bg-card/90 shadow-sm">
              <CardHeader>
                <CardTitle>Room state</CardTitle>
                <CardDescription>
                  Current snapshots for the global room and active page rooms.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Tabs defaultValue="global" className="gap-5">
                  <TabsList variant="line" className="p-0">
                    <TabsTrigger value="global">Global</TabsTrigger>
                    <TabsTrigger value="pages">Page rooms</TabsTrigger>
                    <TabsTrigger value="readers">Readers</TabsTrigger>
                  </TabsList>

                  <TabsContent value="global" className="space-y-4">
                    <RoomMetaList
                      rows={[
                        ["Room", snapshot?.roomId ?? "global"],
                        ["Revision", snapshot?.revision?.toString() ?? "0"],
                        ["Updated", snapshot?.updatedAt ?? "—"],
                        ["Online", snapshot?.onlineCount?.toString() ?? "0"],
                      ]}
                    />
                  </TabsContent>

                  <TabsContent value="pages">
                    <ScrollArea className="h-[280px] pr-3">
                      <div className="flex flex-col gap-3">
                        {activePages.length === 0 ? (
                          <EmptyCopy text="No active page rooms yet." />
                        ) : (
                          activePages.map((page) => (
                            <Card
                              key={page.canonicalUrl}
                              size="sm"
                              className="rounded-[1.25rem] border border-border/70 bg-background/90"
                            >
                              <CardContent className="flex items-start justify-between gap-4 pt-3">
                                <div className="min-w-0">
                                  <div className="truncate font-medium">
                                    {page.title}
                                  </div>
                                  <div className="mt-1 truncate text-xs text-muted-foreground">
                                    {page.canonicalUrl}
                                  </div>
                                </div>
                                <div className="text-right">
                                  <div className="font-medium">
                                    {page.count}
                                  </div>
                                  <div className="text-xs text-muted-foreground">
                                    active sessions
                                  </div>
                                </div>
                              </CardContent>
                            </Card>
                          ))
                        )}
                      </div>
                    </ScrollArea>
                  </TabsContent>

                  <TabsContent value="readers">
                    <ScrollArea className="h-[280px] pr-3">
                      <div className="flex flex-col gap-3">
                        {readers.length === 0 ? (
                          <EmptyCopy text="No readers online." />
                        ) : (
                          readers.map((reader) => (
                            <Card
                              key={reader.readerId}
                              size="sm"
                              className="rounded-[1.25rem] border border-border/70 bg-background/90"
                            >
                              <CardContent className="flex items-start justify-between gap-4 pt-3">
                                <div>
                                  <div className="font-medium">
                                    {reader.displayName}
                                  </div>
                                  <div className="mt-1 text-xs text-muted-foreground">
                                    {reader.page?.title ?? "No page"} ·{" "}
                                    {reader.source}
                                  </div>
                                </div>
                                <div className="text-right">
                                  <Badge variant="secondary">
                                    {reader.presenceState}
                                  </Badge>
                                  <div className="mt-2 text-xs text-muted-foreground">
                                    {reader.reading?.progressPercent ?? 0}%
                                  </div>
                                </div>
                              </CardContent>
                            </Card>
                          ))
                        )}
                      </div>
                    </ScrollArea>
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>

            <RealtimeObservabilityPanel debug={debug} />
          </div>

          <div className="space-y-6">
            <LiveMediaPanel
              readers={deviceReaders}
              title="Device media"
              subtitle="Current media sessions visible in the global room."
            />

            <Card className="rounded-[1.75rem] border border-border/70 bg-card/90 shadow-sm">
              <CardHeader>
                <CardTitle>Room map</CardTitle>
                <CardDescription>
                  Semantic view of the room graph currently represented in the
                  app.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <RoomPill label="presence:site:global" />
                {activePages.length > 0 ? (
                  activePages
                    .slice(0, 4)
                    .map((page) => (
                      <RoomPill
                        key={page.canonicalUrl}
                        label={`presence:page:${page.canonicalUrl}`}
                      />
                    ))
                ) : (
                  <EmptyCopy text="No page-specific rooms currently active." />
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </section>
    </main>
  );
}

function SummaryCard(props: {
  title: string;
  value: string;
  subtitle: string;
}) {
  return (
    <Card className="rounded-[1.5rem] border border-border/70 bg-card/90 shadow-sm">
      <CardHeader>
        <CardDescription>{props.title}</CardDescription>
        <CardTitle className="text-4xl font-semibold tracking-tight">
          {props.value}
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0 text-sm text-muted-foreground">
        {props.subtitle}
      </CardContent>
    </Card>
  );
}

function RoomMetaList(props: { rows: Array<[string, string]> }) {
  return (
    <div className="flex flex-col gap-4">
      {props.rows.map(([label, value], index) => (
        <div key={label}>
          {index > 0 ? <Separator className="mb-4" /> : null}
          <div className="flex items-center justify-between gap-4">
            <span className="text-sm text-muted-foreground">{label}</span>
            <span className="truncate text-sm font-medium">{value}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function RoomPill(props: { label: string }) {
  return (
    <div className="rounded-full bg-secondary px-4 py-2 text-xs font-medium text-secondary-foreground">
      {props.label}
    </div>
  );
}

function EmptyCopy(props: { text: string }) {
  return <p className="text-sm text-muted-foreground">{props.text}</p>;
}
