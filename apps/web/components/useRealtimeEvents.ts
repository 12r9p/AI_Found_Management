"use client";
import { useEffect } from "react";
import { useToast } from "./ui";

interface RealtimeEventData {
  type: "notification" | "match" | "ping";
  data: {
    id?: string;
    title?: string;
    body?: string;
    type?: string;
    timestamp?: string;
  };
}

export function useRealtimeEvents() {
  const toast = useToast();

  useEffect(() => {
    const apiBase = process.env.NEXT_PUBLIC_API_URL || "";
    const sseUrl = `${apiBase.replace(/\/$/, "")}/api/events`;

    let eventSource: EventSource | null = null;
    try {
      eventSource = new EventSource(sseUrl, { withCredentials: true });

      eventSource.onmessage = (e) => {
        try {
          const event: RealtimeEventData = JSON.parse(e.data);
          if (event.type === "notification" && event.data.title) {
            toast(`${event.data.title}${event.data.body ? `: ${event.data.body}` : ""}`, {
              tone: "success",
            });
            window.dispatchEvent(
              new CustomEvent("app:notification_received", { detail: event.data }),
            );
          }
        } catch {
          // JSON パースエラーは無視
        }
      };

      eventSource.onerror = () => {
        // EventSource は自動的に再接続を試みるためログ抑制
      };
    } catch (e) {
      console.warn("SSE connection initialization failed:", e);
    }

    return () => {
      if (eventSource) {
        eventSource.close();
      }
    };
  }, [toast]);
}
