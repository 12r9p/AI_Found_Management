"use client";

import { useEffect } from "react";
import { clearPwaCaches } from "../lib/pwa";

/** 本番だけService Workerを登録し、開発環境に残った古い登録は片付ける。 */
export function PwaRegistration() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    if (process.env.NODE_ENV !== "production") {
      void clearPwaCaches().catch(() => {});
      return;
    }

    const register = async () => {
      try {
        const registration = await navigator.serviceWorker.register("/sw.js", {
          scope: "/",
          updateViaCache: "none",
        });
        await registration.update();
      } catch (error) {
        console.warn("PWA Service Workerの登録に失敗しました", error);
      }
    };

    void register();
  }, []);

  return null;
}
