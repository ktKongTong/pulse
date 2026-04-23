import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
} from "react-router";
import { PulseRealtimeProvider } from "@pulse/realtime-react";

import "./app.css";
import {
  REALTIME_BASE_URL,
  READING_HEARTBEAT_MS,
  READING_PROGRESS_DELTA_PERCENT,
  READING_PROGRESS_THROTTLE_MS,
  SITE_ID,
  WORKSPACE_ID,
} from "./lib/config";
import { TooltipProvider } from "./components/ui/tooltip";

export const links = () => [
  { rel: "preconnect", href: "https://fonts.googleapis.com" },
  {
    rel: "preconnect",
    href: "https://fonts.gstatic.com",
    crossOrigin: "anonymous",
  },
  {
    rel: "stylesheet",
    href: "https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600;9..144,700&family=Manrope:wght@400;500;600;700;800&display=swap",
  },
];

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body className="min-h-screen text-slate-950 antialiased">
        <TooltipProvider>
        <PulseRealtimeProvider
          config={{
            // baseUrl: REALTIME_BASE_URL,
            workspaceId: WORKSPACE_ID,
            siteId: SITE_ID,
            readingHeartbeatMs: READING_HEARTBEAT_MS,
            readingProgressThrottleMs: READING_PROGRESS_THROTTLE_MS,
            readingProgressDeltaPercent: READING_PROGRESS_DELTA_PERCENT,
            interactionActor: { kind: "owner", userId: "kt" },
          }}
        >
          {children}
          </PulseRealtimeProvider>
        </TooltipProvider>
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}

export function ErrorBoundary({ error }: { error: unknown }) {
  let message = "Oops!";
  let details = "An unexpected error occurred.";
  let stack: string | undefined;

  if (isRouteErrorResponse(error)) {
    message = error.status === 404 ? "404" : "Error";
    details =
      error.status === 404
        ? "The requested page could not be found."
        : error.statusText || details;
  } else if (import.meta.env.DEV && error && error instanceof Error) {
    details = error.message;
    stack = error.stack;
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-5xl items-center justify-center px-6 py-20">
      <section className="w-full max-w-2xl rounded-[2rem] border p-10 shadow-[0_30px_90px_rgba(15,23,42,0.12)] backdrop-blur-xl">
        <p className="text-xs font-semibold uppercase tracking-[0.35em] text-slate-500">
          PulseBar
        </p>
        <h1 className="mt-4 font-display text-5xl font-bold tracking-tight text-slate-950">
          {message}
        </h1>
        <p className="mt-4 text-lg text-slate-600">{details}</p>
        {stack && (
          <pre className="mt-8 w-full overflow-x-auto rounded-3xl bg-slate-950 p-5 text-sm text-slate-100">
            <code>{stack}</code>
          </pre>
        )}
      </section>
    </main>
  );
}
