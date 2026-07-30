import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { buildContext, type AppContext } from "./context.ts";
import { getEnv } from "./env-holder.ts";
import { itemEmbedText, inquiryEmbedText } from "./lib/embed-text.ts";
import { matchNewItem, matchNewInquiry } from "./lib/matching.ts";
import { arrayBufferToDataUrl, extFromContentType } from "./lib/img.ts";
import { getIdRule, setIdRule, nextDisplayId, previewId, normalizeRule } from "./lib/idrule.ts";
import { verifyAccessJwt } from "./lib/access.ts";
import type { SearchFilters } from "./types.ts";

/** 現在有効な地図画像のキーを保持する設定キー。 */
const ACTIVE_MAP_KEY = "active_map_key";

export const CATEGORIES = [
  "財布", "かばん", "傘", "スマートフォン", "携帯電話", "鍵", "水筒",
  "眼鏡", "帽子", "衣類", "イヤホン", "時計", "アクセサリー", "書類",
  "カード類", "現金", "おもちゃ", "その他",
];
export const COLORS = [
  "黒", "白", "灰", "紺", "青", "水色", "赤", "ピンク", "橙", "黄",
  "緑", "茶", "ベージュ", "紫", "金", "銀", "透明", "その他",
];
export const ITEM_STATUSES = ["stored", "returned", "disposed", "transferred"];
export const INQUIRY_STATUSES = ["open", "matched", "resolved", "closed"];

function parseFilters(q: Record<string, any>): SearchFilters {
  return {
    q: q.q || undefined,
    category: q.category || undefined,
    color: q.color || undefined,
    status: q.status || undefined,
    location: q.location || undefined,
    from: q.from || undefined,
    to: q.to || undefined,
    limit: q.limit ? parseInt(q.limit, 10) : undefined,
  };
}

async function ctx(): Promise<AppContext> {
  return buildContext(getEnv());
}

/** 設定に保存されたリスト（種別・色）を読む。未設定・壊れていれば既定値。 */
async function readList(
  store: AppContext["store"],
  key: string,
  fallback: string[],
): Promise<string[]> {
  const raw = await store.getSetting(key);
  if (!raw) return fallback;
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) && v.length ? v.map(String) : fallback;
  } catch {
    return fallback;
  }
}

export function createApp() {
  const app = new Elysia()
    .onError(({ error, code, set }) => {
      const status = code === "NOT_FOUND" ? 404 : 500;
      set.status = status;
      console.error("[api error]", code, (error as Error)?.message);
      return { error: (error as Error)?.message ?? "internal error", code };
    })
    .use(
      cors({
        origin: true, // 認証は Cloudflare Zero Trust に委譲。CORS は許可（同一 Access 配下）。
        credentials: true,
      }),
    )
    // ---- Cloudflare Access (Zero Trust) 検証 ----
    // ACCESS_TEAM_DOMAIN と ACCESS_AUD が設定されている場合のみ有効。
    // Worker URL への直アクセスを塞ぐ多層防御。ローカルでは素通し。
    .onBeforeHandle(async ({ request, set, path }) => {
      const c = await ctx();
      if (!c.cfg.access.enabled) return;
      if (path === "/" || path === "/api/health") return; // ヘルスチェックは除外
      if (request.method === "OPTIONS") return; // CORS プリフライト
      try {
        await verifyAccessJwt(
          request.headers.get("Cf-Access-Jwt-Assertion"),
          c.cfg.access.teamDomain!,
          c.cfg.access.aud!,
        );
      } catch (e) {
        set.status = 403;
        return { error: `Access denied: ${(e as Error).message}` };
      }
    })

    // ---- meta ----
    .get("/", () => ({ name: "found-api", ok: true }))
    .get("/api/health", async () => {
      const c = await ctx();
      return {
        ok: true,
        store: c.store.kind,
        ai: c.ai.name,
        matchThreshold: c.cfg.matchThreshold,
        embedDim: c.cfg.ai.embedDim,
        accessProtected: c.cfg.access.enabled,
      };
    })
    // 種別・色はスタッフが設定画面から編集できる（現場ごとに扱う物品が違うため）。
    // 未設定なら既定リストを返す。
    .get("/api/meta", async () => {
      const c = await ctx();
      return {
        categories: await readList(c.store, "categories", CATEGORIES),
        colors: await readList(c.store, "colors", COLORS),
        itemStatuses: ITEM_STATUSES,
        inquiryStatuses: INQUIRY_STATUSES,
      };
    })
    .put("/api/meta/:kind", async ({ params, body, set }) => {
      const kind = params.kind;
      if (kind !== "categories" && kind !== "colors") {
        set.status = 400;
        return { error: "categories か colors のみ変更できます" };
      }
      const c = await ctx();
      const raw = (body as any)?.values;
      if (!Array.isArray(raw)) {
        set.status = 400;
        return { error: "values は配列で指定してください" };
      }
      const values = Array.from(
        new Set(raw.map((v: any) => String(v).trim()).filter(Boolean)),
      ).slice(0, 200);
      if (values.length === 0) {
        set.status = 400;
        return { error: "1件以上必要です" };
      }
      await c.store.setSetting(kind, JSON.stringify(values));
      return { values };
    })

    // ---- 管理番号の採番ルール ----
    .get("/api/id-rule", async () => {
      const c = await ctx();
      const rule = await getIdRule(c.store);
      return { rule, preview: previewId(rule) };
    })
    .put("/api/id-rule", async ({ body }) => {
      const c = await ctx();
      const rule = await setIdRule(c.store, normalizeRule((body as any)?.rule));
      return { rule, preview: previewId(rule) };
    })

    // ---- uploads / images ----
    .post("/api/uploads", async ({ body, set }) => {
      const c = await ctx();
      const b = body as any;
      const files: File[] = [];
      if (b && typeof b === "object") {
        for (const key of Object.keys(b)) {
          const v = b[key];
          if (v instanceof File) files.push(v);
          else if (Array.isArray(v)) for (const f of v) if (f instanceof File) files.push(f);
        }
      }
      if (files.length === 0) {
        set.status = 400;
        return { error: "画像ファイルがありません（multipart/form-data で送信してください）" };
      }
      const keys: string[] = [];
      for (const f of files.slice(0, 2)) {
        const ct = f.type || "image/jpeg";
        const key = `img_${crypto.randomUUID()}.${extFromContentType(ct)}`;
        await c.images.put(key, await f.arrayBuffer(), ct);
        keys.push(key);
      }
      return { keys };
    })
    .get("/api/images/:key", async ({ params, set }) => {
      const c = await ctx();
      const obj = await c.images.get(params.key);
      if (!obj) {
        set.status = 404;
        return "not found";
      }
      set.headers["content-type"] = obj.contentType;
      set.headers["cache-control"] = "public, max-age=31536000, immutable";
      return new Uint8Array(obj.body);
    })

    // ---- 地図（拾得場所のピン留め用） ----
    .get("/api/map", async () => {
      const c = await ctx();
      const key = await c.store.getSetting(ACTIVE_MAP_KEY);
      return { key: key ?? "" };
    })
    .post("/api/map", async ({ body, set }) => {
      const c = await ctx();
      const b = body as any;
      let file: File | null = null;
      if (b && typeof b === "object") {
        for (const k of Object.keys(b)) {
          if (b[k] instanceof File) {
            file = b[k];
            break;
          }
        }
      }
      if (!file) {
        set.status = 400;
        return { error: "地図画像がありません（multipart/form-data）" };
      }
      const ct = file.type || "image/png";
      const key = `map_${crypto.randomUUID()}.${extFromContentType(ct)}`;
      await c.images.put(key, await file.arrayBuffer(), ct);
      await c.store.setSetting(ACTIVE_MAP_KEY, key);
      return { key };
    })

    // ---- AI analyze (tagging) ----
    .post("/api/analyze", async ({ body }) => {
      const c = await ctx();
      const b = (body as any) ?? {};
      const dataUrls: string[] = [];
      for (const url of b.dataUrls ?? []) if (typeof url === "string") dataUrls.push(url);
      for (const key of b.keys ?? []) {
        const obj = await c.images.get(key);
        if (obj) dataUrls.push(arrayBufferToDataUrl(obj.body, obj.contentType));
      }
      const result = await c.ai.describeImages(
        dataUrls.map((url) => ({ url })),
        b.hint,
      );
      return result;
    })

    // ---- items ----
    .get("/api/items", async ({ query }) => {
      const c = await ctx();
      return { items: await c.store.listItems(parseFilters(query as any)) };
    })
    .post("/api/items", async ({ body }) => {
      const c = await ctx();
      const b = (body as any) ?? {};
      // 画像はあるが特徴文が無ければ、この場で AI タグ付けする
      let ai_description = b.ai_description ?? "";
      let tags: string[] = Array.isArray(b.tags) ? b.tags : [];
      let category = b.category ?? "";
      let color = b.color ?? "";
      let brand = b.brand ?? "";
      const keys: string[] = Array.isArray(b.image_keys) ? b.image_keys : [];
      if (!ai_description && keys.length > 0) {
        const dataUrls: string[] = [];
        for (const key of keys) {
          const obj = await c.images.get(key);
          if (obj) dataUrls.push(arrayBufferToDataUrl(obj.body, obj.contentType));
        }
        const d = await c.ai.describeImages(dataUrls.map((url) => ({ url })), b.notes);
        ai_description = d.description;
        tags = tags.length ? tags : d.tags;
        category = category || d.category;
        color = color || d.color;
        brand = brand || d.brand;
      }
      const draft = {
        status: b.status ?? "stored",
        category, color, brand,
        found_location: b.found_location ?? "",
        found_at: b.found_at ?? null,
        map_key: b.map_key ?? "",
        found_x: typeof b.found_x === "number" ? b.found_x : null,
        found_y: typeof b.found_y === "number" ? b.found_y : null,
        storage_location: b.storage_location ?? "",
        image_keys: keys,
        ai_description,
        tags,
        notes: b.notes ?? "",
      };
      const embedding = await c.ai.embed(itemEmbedText(draft));
      // 管理番号は設定の採番ルールに従って自動付与（現場・紙台帳での照合用）
      const display_id = b.display_id || (await nextDisplayId(c.store));
      const item = await c.store.createItem({ ...draft, display_id, embedding });
      item.embedding = embedding; // pg 実装は embedding を返さないため補完
      const outcome =
        item.status === "stored"
          ? await matchNewItem(c.store, item, c.cfg.matchThreshold)
          : { matches: [], topScore: 0 };
      return { item, matches: outcome.matches, topScore: outcome.topScore };
    })
    .get("/api/items/:id", async ({ params, set }) => {
      const c = await ctx();
      const item = await c.store.getItem(params.id);
      if (!item) {
        set.status = 404;
        return { error: "not found" };
      }
      const matches = (await c.store.listMatches()).filter((m) => m.item_id === params.id);
      return { item, matches };
    })
    .patch("/api/items/:id", async ({ params, body, set }) => {
      const c = await ctx();
      const existing = await c.store.getItem(params.id);
      if (!existing) {
        set.status = 404;
        return { error: "not found" };
      }
      const patch = { ...(body as any) };
      delete patch.id;
      delete patch.embedding; // 埋め込みは派生値。手編集させない
      // 特徴に関わる項目が変わったら再埋め込み
      const touchesFeatures = [
        "category", "color", "brand", "ai_description", "tags", "found_location", "notes",
      ].some((k) => k in patch);
      let embedding: number[] | undefined;
      if (touchesFeatures) {
        embedding = await c.ai.embed(itemEmbedText({ ...existing, ...patch }));
      }
      const updated = await c.store.updateItem(params.id, { ...patch, ...(embedding ? { embedding } : {}) });
      if (updated && embedding) {
        updated.embedding = embedding;
        if (updated.status === "stored") await matchNewItem(c.store, updated, c.cfg.matchThreshold);
      }
      return { item: updated };
    })
    .delete("/api/items/:id", async ({ params }) => {
      const c = await ctx();
      const item = await c.store.getItem(params.id);
      for (const key of item?.image_keys ?? []) await c.images.delete(key).catch(() => {});
      return { deleted: await c.store.deleteItem(params.id) };
    })

    // ---- search (vector + filters) ----
    .post("/api/search", async ({ body }) => {
      const c = await ctx();
      const b = (body as any) ?? {};
      const filters: SearchFilters = { ...parseFilters(b), limit: b.limit ?? 50 };
      if (!filters.q) {
        // クエリ無しならフィルタのみの一覧
        return { items: (await c.store.listItems(filters)).map((i) => ({ ...i, score: null })) };
      }
      const embedding = await c.ai.embed(filters.q);
      const items = await c.store.searchItems(embedding, filters);
      return { items };
    })

    // ---- inquiries ----
    .get("/api/inquiries", async ({ query }) => {
      const c = await ctx();
      const inquiries = await c.store.listInquiries((query as any).status);
      // ?withMatches=1 で照合候補（＋物品の画像）を同梱。
      // 問い合わせ一覧から候補を写真付きで確認できるようにするため。
      if ((query as any).withMatches !== "1") return { inquiries };
      const allMatches = await c.store.listMatches();
      const itemCache = new Map<string, Awaited<ReturnType<typeof c.store.getItem>>>();
      const getItem = async (id: string) => {
        if (!itemCache.has(id)) itemCache.set(id, await c.store.getItem(id));
        return itemCache.get(id) ?? null;
      };
      const enriched = await Promise.all(
        inquiries.map(async (inq) => {
          const mine = allMatches
            .filter((m) => m.inquiry_id === inq.id && m.status !== "rejected")
            .sort((a, b) => b.score - a.score);
          return {
            ...inq,
            matches: await Promise.all(
              mine.map(async (m) => ({ ...m, item: await getItem(m.item_id) })),
            ),
          };
        }),
      );
      return { inquiries: enriched };
    })
    .post("/api/inquiries", async ({ body }) => {
      const c = await ctx();
      const b = (body as any) ?? {};
      const draft = {
        status: "open" as const,
        description: b.description ?? "",
        category: b.category ?? "",
        color: b.color ?? "",
        ai_description: b.description ?? "",
        tags: Array.isArray(b.tags) ? b.tags : [],
        reference_no: b.reference_no ?? "",
        notes: b.notes ?? "",
      };
      const embedding = await c.ai.embed(inquiryEmbedText(draft));
      const inquiry = await c.store.createInquiry({ ...draft, embedding });
      inquiry.embedding = embedding;
      const outcome = await matchNewInquiry(c.store, inquiry, c.cfg.matchThreshold);
      return { inquiry, matches: outcome.matches, topScore: outcome.topScore };
    })
    .get("/api/inquiries/:id", async ({ params, set }) => {
      const c = await ctx();
      const inquiry = await c.store.getInquiry(params.id);
      if (!inquiry) {
        set.status = 404;
        return { error: "not found" };
      }
      const matches = (await c.store.listMatches()).filter((m) => m.inquiry_id === params.id);
      return { inquiry, matches };
    })
    .patch("/api/inquiries/:id", async ({ params, body, set }) => {
      const c = await ctx();
      const existing = await c.store.getInquiry(params.id);
      if (!existing) {
        set.status = 404;
        return { error: "not found" };
      }
      const patch = { ...(body as any) };
      delete patch.id;
      delete patch.embedding;
      const touches = ["category", "color", "description", "tags", "notes"].some((k) => k in patch);
      let embedding: number[] | undefined;
      if (touches) embedding = await c.ai.embed(inquiryEmbedText({ ...existing, ...patch }));
      const updated = await c.store.updateInquiry(params.id, {
        ...patch,
        ...(embedding ? { embedding } : {}),
      });
      return { inquiry: updated };
    })
    .delete("/api/inquiries/:id", async ({ params }) => {
      const c = await ctx();
      return { deleted: await c.store.deleteInquiry(params.id) };
    })

    // ---- matches ----
    .get("/api/matches", async ({ query }) => {
      const c = await ctx();
      const matches = await c.store.listMatches((query as any).status);
      // 参照物品・問い合わせの要約を同梱（画面で扱いやすく）
      const enriched = await Promise.all(
        matches.map(async (m) => ({
          ...m,
          item: await c.store.getItem(m.item_id),
          inquiry: await c.store.getInquiry(m.inquiry_id),
        })),
      );
      return { matches: enriched };
    })
    .patch("/api/matches/:id", async ({ params, body, set }) => {
      const c = await ctx();
      const m = await c.store.getMatch(params.id);
      if (!m) {
        set.status = 404;
        return { error: "not found" };
      }
      const status = (body as any)?.status;
      const updated = await c.store.updateMatch(params.id, { status });
      if (status === "confirmed") {
        // 一致確定：問い合わせを解決に、遺失物は返却手続きへ（保管中→返却は現場判断）
        await c.store.updateInquiry(m.inquiry_id, { status: "resolved", matched_item_id: m.item_id });
      } else if (status === "rejected") {
        const inq = await c.store.getInquiry(m.inquiry_id);
        if (inq && inq.status === "matched") {
          const others = (await c.store.listMatches()).filter(
            (x) => x.inquiry_id === m.inquiry_id && x.id !== m.id && x.status === "pending",
          );
          if (others.length === 0) await c.store.updateInquiry(m.inquiry_id, { status: "open" });
        }
      }
      return { match: updated };
    })

    // ---- notifications ----
    .get("/api/notifications", async ({ query }) => {
      const c = await ctx();
      return { notifications: await c.store.listNotifications((query as any).unread === "1") };
    })
    .get("/api/notifications/unread-count", async () => {
      const c = await ctx();
      return { count: await c.store.unreadCount() };
    })
    .post("/api/notifications/:id/read", async ({ params }) => {
      const c = await ctx();
      return { ok: await c.store.markNotificationRead(params.id) };
    })

    // ---- CSV export (bonus) ----
    .get("/api/export/items.csv", async ({ query, set }) => {
      const c = await ctx();
      const items = await c.store.listItems(parseFilters(query as any));
      const head = [
        "id", "status", "category", "color", "brand", "found_location",
        "map_pin", "found_at", "storage_location", "ai_description", "tags", "created_at",
      ];
      const esc = (s: any) => `"${String(s ?? "").replace(/"/g, '""')}"`;
      const rows = items.map((i) =>
        [
          i.id, i.status, i.category, i.color, i.brand, i.found_location,
          i.found_x != null && i.found_y != null
            ? `${(i.found_x * 100).toFixed(1)}%,${(i.found_y * 100).toFixed(1)}%`
            : "",
          i.found_at ?? "", i.storage_location, i.ai_description, i.tags.join(";"), i.created_at,
        ]
          .map(esc)
          .join(","),
      );
      set.headers["content-type"] = "text/csv; charset=utf-8";
      set.headers["content-disposition"] = 'attachment; filename="items.csv"';
      return "﻿" + [head.join(","), ...rows].join("\n");
    });

  return app;
}

export type App = ReturnType<typeof createApp>;
