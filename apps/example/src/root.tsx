// import { scan } from "react-scan/all-environments";
import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";
import { PulseRealtimeV2Provider } from "@pulse/v2-realtime-react";
import { realtimeConfig } from "./lib/config";
import { TooltipProvider } from "./components/ui/tooltip";
import "./styles.css";

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
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="theme-color" content="#faf8f6" />
        <script
          crossOrigin="anonymous"
          src="https://unpkg.com/react-scan/dist/auto.global.js"
        ></script>
        <Meta />
        <Links />
      </head>
      <body className="min-h-screen text-slate-950 antialiased">
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return (
    <PulseRealtimeV2Provider config={realtimeConfig}>
      <TooltipProvider>
        <Outlet />
      </TooltipProvider>
    </PulseRealtimeV2Provider>
  );
}
