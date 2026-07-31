import type { Item, Inquiry, Match, Notification, Meta, IdRule, LocationPreset } from "./types";

export const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8787";

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      ...(init?.body && !(init.body instanceof FormData)
        ? { "content-type": "application/json" }
        : {}),
      ...(init?.headers ?? {}),
    },
    credentials: "include",
  });
  if (!res.ok) {
    let msg = `${res.status}`;
    try {
      const j = await res.json();
      msg = (j as any).error ?? msg;
    } catch {
      /* noop */
    }
    throw new Error(msg);
  }
  const ct = res.headers.get("content-type") ?? "";
  return (ct.includes("json") ? res.json() : (res.text() as any)) as Promise<T>;
}

export const imageUrl = (key: string) => `${API_BASE}/api/images/${key}`;

export const api = {
  health: () => req<{ ok: boolean; store: string; ai: string; matchThreshold: number }>("/api/health"),
  meta: () => req<Meta>("/api/meta"),
  getIdRule: () => req<{ rule: IdRule; preview: string }>("/api/id-rule"),
  updateIdRule: (rule: IdRule) =>
    req<{ rule: IdRule; preview: string }>("/api/id-rule", {
      method: "PUT",
      body: JSON.stringify({ rule }),
    }),
  updateMeta: (kind: "categories" | "colors", values: string[]) =>
    req<{ values: string[] }>(`/api/meta/${kind}`, {
      method: "PUT",
      body: JSON.stringify({ values }),
    }).then((r) => r.values),

  // items
  listItems: (q: Record<string, string> = {}) =>
    req<{ items: Item[] }>(`/api/items?${new URLSearchParams(q)}`).then((r) => r.items),
  getItem: (id: string) => req<{ item: Item; matches: Match[] }>(`/api/items/${id}`),
  createItem: (body: Partial<Item>) =>
    req<{ item: Item; matches: Match[]; topScore: number }>("/api/items", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateItem: (id: string, patch: Partial<Item>) =>
    req<{ item: Item }>(`/api/items/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  deleteItem: (id: string) => req<{ deleted: boolean }>(`/api/items/${id}`, { method: "DELETE" }),

  // search
  search: (body: Record<string, unknown>) =>
    req<{ items: Item[] }>("/api/search", { method: "POST", body: JSON.stringify(body) }).then((r) => r.items),

  // 保管中の全物品を未解決の問い合わせと一括で再照合する（管理画面の手動トリガー）
  rematchAll: () => req<{ itemsChecked: number; matchesFound: number }>("/api/rematch", { method: "POST" }),

  // uploads / analyze
  upload: (files: File[]) => {
    const fd = new FormData();
    files.forEach((f, i) => fd.append(`image${i}`, f));
    return req<{ keys: string[] }>("/api/uploads", { method: "POST", body: fd });
  },
  analyze: (body: { keys?: string[]; dataUrls?: string[]; hint?: string }) =>
    req<{ description: string; tags: string[]; category: string; color: string; brand: string }>(
      "/api/analyze",
      { method: "POST", body: JSON.stringify(body) },
    ),

  // inquiries
  /** withMatches=true で照合候補（物品の画像込み）を同梱して返す。 */
  listInquiries: (status?: string, withMatches = false) => {
    const p = new URLSearchParams();
    if (status) p.set("status", status);
    if (withMatches) p.set("withMatches", "1");
    const qs = p.toString();
    return req<{ inquiries: Inquiry[] }>(`/api/inquiries${qs ? `?${qs}` : ""}`).then((r) => r.inquiries);
  },
  getInquiry: (id: string) => req<{ inquiry: Inquiry; matches: Match[] }>(`/api/inquiries/${id}`),
  createInquiry: (body: Partial<Inquiry>) =>
    req<{ inquiry: Inquiry; matches: Match[]; topScore: number }>("/api/inquiries", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateInquiry: (id: string, patch: Partial<Inquiry>) =>
    req<{ inquiry: Inquiry }>(`/api/inquiries/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  deleteInquiry: (id: string) => req<{ deleted: boolean }>(`/api/inquiries/${id}`, { method: "DELETE" }),

  // matches
  listMatches: (status?: string) =>
    req<{ matches: Match[] }>(`/api/matches${status ? `?status=${status}` : ""}`).then((r) => r.matches),
  updateMatch: (id: string, status: string) =>
    req<{ match: Match }>(`/api/matches/${id}`, { method: "PATCH", body: JSON.stringify({ status }) }),

  // notifications
  notifications: (unread = false) =>
    req<{ notifications: Notification[] }>(`/api/notifications${unread ? "?unread=1" : ""}`).then((r) => r.notifications),
  unreadCount: () => req<{ count: number }>("/api/notifications/unread-count").then((r) => r.count),
  markRead: (id: string) => req<{ ok: boolean }>(`/api/notifications/${id}/read`, { method: "POST" }),

  // map (拾得場所の地図)
  getMap: () => req<{ key: string }>("/api/map").then((r) => r.key),
  uploadMap: (file: File) => {
    const fd = new FormData();
    fd.append("map", file);
    return req<{ key: string }>("/api/map", { method: "POST", body: fd }).then((r) => r.key);
  },

  // 拾得場所プリセット（名前 ⇔ 地図ピン位置）
  getLocationPresets: () =>
    req<{ presets: LocationPreset[] }>("/api/location-presets").then((r) => r.presets),
  updateLocationPresets: (presets: LocationPreset[]) =>
    req<{ presets: LocationPreset[] }>("/api/location-presets", {
      method: "PUT",
      body: JSON.stringify({ presets }),
    }).then((r) => r.presets),

  csvUrl: (q: Record<string, string> = {}) => `${API_BASE}/api/export/items.csv?${new URLSearchParams(q)}`,
};
