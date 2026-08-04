import type {
  Item,
  Inquiry,
  Match,
  Notification,
  Meta,
  MetaOption,
  IdRule,
  LocationPreset,
} from "./types";

export interface ItemPage {
  items: Item[];
  nextCursor: ItemCursor | null;
}

export interface ItemCursor {
  createdAt: string;
  id: string;
}

export interface RematchPage {
  itemsChecked: number;
  matchesFound: number;
  failed: number;
  nextCursor: ItemCursor | null;
  done: boolean;
}

export function itemCursorsEqual(
  left: ItemCursor | null | undefined,
  right: ItemCursor | null | undefined,
): boolean {
  if (!left || !right) return left === right;
  return left.createdAt === right.createdAt && left.id === right.id;
}

export const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8787";

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      ...(init?.body && !(init.body instanceof FormData)
        ? { "content-type": "application/json" }
        : {}),
      ...init?.headers,
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
  health: () =>
    req<{ ok: boolean; store: string; ai: string; matchThreshold: number }>("/api/health"),
  meta: () => req<Meta>("/api/meta"),
  getIdRule: () => req<{ rule: IdRule; preview: string }>("/api/id-rule"),
  updateIdRule: (rule: IdRule) =>
    req<{ rule: IdRule; preview: string }>("/api/id-rule", {
      method: "PUT",
      body: JSON.stringify({ rule }),
    }),
  updateMeta: (kind: "categories" | "colors", values: MetaOption[]) =>
    req<{ values: MetaOption[] }>(`/api/meta/${kind}`, {
      method: "PUT",
      body: JSON.stringify({ values }),
    }).then((r) => r.values),

  // items
  listItems: (q: Record<string, string> = {}) =>
    req<ItemPage>(`/api/items?${new URLSearchParams(q)}`),
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
  // degraded: true は埋め込み(AI)に失敗し、フィルタのみの結果にフォールバックしたことを示す。
  search: (body: Record<string, unknown>) =>
    req<{ items: Item[]; degraded?: boolean }>("/api/search", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  // 保管中の物品を100件ずつ再照合し、管理画面側で終端まで順に呼び出す。
  rematchPage: (cursor?: ItemCursor, runId?: string) =>
    req<RematchPage>("/api/rematch", {
      method: "POST",
      body: JSON.stringify({
        ...(cursor ? { cursor } : {}),
        ...(runId ? { runId } : {}),
      }),
    }),
  finishRematch: (runId: string) =>
    req<{ ok: boolean }>("/api/rematch/finish", {
      method: "POST",
      body: JSON.stringify({ runId }),
    }),

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
    return req<{ inquiries: Inquiry[] }>(`/api/inquiries${qs ? `?${qs}` : ""}`).then(
      (r) => r.inquiries,
    );
  },
  getInquiry: (id: string) => req<{ inquiry: Inquiry; matches: Match[] }>(`/api/inquiries/${id}`),
  createInquiry: (body: Partial<Inquiry>) =>
    req<{ inquiry: Inquiry; matches: Match[]; topScore: number }>("/api/inquiries", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateInquiry: (id: string, patch: Partial<Inquiry>) =>
    req<{ inquiry: Inquiry }>(`/api/inquiries/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
  deleteInquiry: (id: string) =>
    req<{ deleted: boolean }>(`/api/inquiries/${id}`, { method: "DELETE" }),

  // matches
  listMatches: (status?: string) =>
    req<{ matches: Match[] }>(`/api/matches${status ? `?status=${status}` : ""}`).then(
      (r) => r.matches,
    ),
  updateMatch: (id: string, status: string) =>
    req<{ match: Match }>(`/api/matches/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    }),

  // notifications
  notifications: (unread = false) =>
    req<{ notifications: Notification[] }>(`/api/notifications${unread ? "?unread=1" : ""}`).then(
      (r) => r.notifications,
    ),
  unreadCount: () => req<{ count: number }>("/api/notifications/unread-count").then((r) => r.count),
  markRead: (id: string) =>
    req<{ ok: boolean }>(`/api/notifications/${id}/read`, { method: "POST" }),

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

  csvUrl: (q: Record<string, string> = {}) =>
    `${API_BASE}/api/export/items.csv?${new URLSearchParams(q)}`,
};
