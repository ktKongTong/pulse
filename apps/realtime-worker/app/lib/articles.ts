export interface DemoArticle {
  slug: string;
  title: string;
  author: string;
  excerpt: string;
  recommendedTrackUri: string;
  recommendedTrackTitle: string;
  paragraphs: string[];
}

export const articles: DemoArticle[] = [
  {
    slug: "durable-presence-on-the-edge",
    title: "Durable Presence On The Edge",
    author: "KT",
    excerpt: "Designing room-based realtime presence with Durable Objects and append-only ingest.",
    recommendedTrackUri: "spotify:track:77LQNv3wdUvN5sXG9v5H9u",
    recommendedTrackTitle: "Don't Say \"Lazy\" (From \"K-On!\")",
    paragraphs: [
      "Realtime presence systems get messy when they try to flatten every signal into a single online or offline flag. A better model keeps availability, focus, and media as separate axes so downstream consumers can decide what matters.",
      "Durable Objects are a good fit for room-local state because they give us a natural serialization boundary. One room, one actor, one authoritative revision counter. That makes stream fan-out and dedupe easier to reason about.",
      "The append-only ingest side should stay boring. Devices and browsers send immutable events with eventId and seq, while the room actor turns those events into mutable room snapshots. Mixing these layers is where most systems start leaking complexity.",
      "For a blog, page-level rooms unlock more than vanity counters. They let you show how many people are reading an article right now, how far readers usually make it, and where attention clusters during launches or long-form essays.",
      "The web client still needs local state discipline. Reading progress should be throttled, visibility should affect presence, and page transitions should cleanly remove sessions from old rooms. Otherwise the room state decays into ghost readers."
    ]
  },
  {
    slug: "reading-state-as-presence",
    title: "Reading State As Presence",
    author: "KT",
    excerpt: "Treating scroll position and visibility as realtime presence signals for content systems.",
    recommendedTrackUri: "spotify:track:5hI3qlHEhxns169ckBAthx",
    recommendedTrackTitle: "Fuwa Fuwa ☆ Dreamy Sandwich",
    paragraphs: [
      "Browsing behavior is a kind of presence. A visible article at twenty percent progress means something different from a hidden tab left open for an hour. Systems that collapse both into a single page view lose most of the value.",
      "The smallest useful browser protocol has four events: page_view, reading_progress, heartbeat, and session_end. That is enough to recover active readers, page counts, and live progress with bounded server work.",
      "The UX side matters too. If the client only emits on a fixed timer, the UI always lags behind the person. If it emits on every scroll event, the service becomes noise. A combination of throttling and meaningful deltas is usually enough.",
      "Canonical URLs are not optional. Without them, room identity gets polluted by tracking params, hashes, and inconsistent paths. One article quietly becomes ten distinct rooms and every metric looks smaller than it is.",
      "Once a room model exists, richer interactions become obvious. Reading cohorts, collaborative annotation, article-local chat, and launch-day live comments all fall out of the same state backbone."
    ]
  },
  {
    slug: "from-device-status-to-live-blog",
    title: "From Device Status To Live Blog",
    author: "KT",
    excerpt: "Using the same presence backbone for macOS activity, web readers, and future live social surfaces.",
    recommendedTrackUri: "spotify:track:0WmnmUMRrj79KBc2Me7gSP",
    recommendedTrackTitle: "花の塔",
    paragraphs: [
      "A personal device monitor becomes more interesting when it stops being local-only. The same event stream that captures frontmost apps and media sessions can drive a live blog header, side widgets, or private dashboards.",
      "The important move is to treat transport as an extension layer, not the product itself. The value comes from a stable state model and useful derived rooms. Once the model is right, shipping it to the edge is mostly plumbing.",
      "There is a temptation to jump straight to chat. In practice, presence and reading state are the harder foundations because they force clear rules around identity, expiry, and reconciliation. Chat becomes easier after those decisions are stable.",
      "For v1, anonymous sessions are enough. You can still show active readers, pages in focus, and aggregate progress without demanding sign-in. User identity can stay optional until there is a real need for persistence or moderation.",
      "The durable object acts like a tiny live world for each room. Every browser heartbeat and device snapshot nudges that world forward, and clients subscribe to the authoritative snapshot stream instead of trying to coordinate with each other."
    ]
  }
];

export function articleBySlug(slug: string): DemoArticle | undefined {
  return articles.find((article) => article.slug === slug);
}
