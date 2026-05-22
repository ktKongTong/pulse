"use client"
import { useEffect, useRef } from "react";
import {
    useClientPageConnection,
    usePulseRealtimeV2Client,
} from "@pulse/v2-realtime-react";
type PageParams = {
    title: string,
    url: string,
    canonicalUrl: string
}

export function usePagePresence(page: PageParams) {
    const client = usePulseRealtimeV2Client();
    const seq = useRef(1);
    useClientPageConnection(page.canonicalUrl, {
        title: page.title,
        url: page.url,
    });

    useEffect(() => {
        const publish = () => {
            const scrollable = Math.max(
                1,
                document.documentElement.scrollHeight - window.innerHeight,
            );
            const percent = Math.min(
                100,
                Math.round((window.scrollY / scrollable) * 100),
            );
            client.updatePage(page.canonicalUrl, {
                seq: seq.current,
                reading: { percent, scrollY: Math.round(window.scrollY) },
                page: { title: page.title, url: window.location.href },
            });
            seq.current += 1;
        };

        publish();
        const timer = window.setInterval(publish, 1200);
        window.addEventListener("scroll", publish, { passive: true });
        return () => {
            window.clearInterval(timer);
            window.removeEventListener("scroll", publish);
        };
    }, [client, page]);
}