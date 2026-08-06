/**
 * このオリジンのPWA用Service WorkerとCache Storageを削除する。
 * API/D1/R2のデータやブラウザのHTTPキャッシュは対象にしない。
 */
export async function clearPwaCaches(): Promise<void> {
  if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((registration) => registration.unregister()));
  }

  if (typeof window !== "undefined" && "caches" in window) {
    const cacheNames = await window.caches.keys();
    await Promise.all(cacheNames.map((cacheName) => window.caches.delete(cacheName)));
  }
}
