"use client";
// Inside a /demo device frame (?embed=1): mark the page so CSS can drop full-browser-page chrome, and obey the
// frame page's Mute button. It speaks and approves nothing.
import { useEffect } from "react";
import { isEmbedSearch, setEmbedMuted } from "@/lib/embed";
import { parseMuteMessage } from "@/lib/ui/demoframes";

export default function EmbedBridge() {
  useEffect(() => {
    if (!isEmbedSearch(window.location.search) || window.parent === window) return;
    document.documentElement.dataset.embed = "1";
    const onMsg = (e: MessageEvent) => {
      if (e.source !== window.parent) return;
      const on = parseMuteMessage(e.data, e.origin, window.location.origin);
      if (on === null) return;
      setEmbedMuted(on);
      if (on) {
        try {
          window.speechSynthesis.cancel();
        } catch {
          /* nothing was speaking */
        }
      }
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, []);
  return null;
}
