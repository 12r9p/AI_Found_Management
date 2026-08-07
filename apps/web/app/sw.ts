import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { NetworkFirst, Serwist } from "serwist";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

const buildRevision = process.env.NEXT_PUBLIC_BUILD_REVISION ?? "development";
const cacheId = `found-web-${buildRevision}`;

const serwist = new Serwist({
  cacheId,
  precacheEntries: self.__SW_MANIFEST,
  precacheOptions: {
    cleanupOutdatedCaches: true,
  },
  // 更新済みWorkerをすぐに適用せず、編集中の画面を途中で差し替えない。
  skipWaiting: false,
  clientsClaim: false,
  navigationPreload: true,
  runtimeCaching: [
    {
      // HTMLナビゲーションだけをnetwork-firstにする。RSC、API、画像、書き込みは
      // ルートに一致しないため、Service Workerのキャッシュから返さない。
      matcher: ({ request, sameOrigin }) => sameOrigin && request.mode === "navigate",
      handler: new NetworkFirst({
        cacheName: `${cacheId}-navigation`,
        networkTimeoutSeconds: 3,
      }),
    },
  ],
  disableDevLogs: true,
});

serwist.addEventListeners();
