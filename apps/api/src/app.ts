import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { buildContext, type AppContext } from "./context.ts";
import { getEnv, waitUntil } from "./env-holder.ts";
import { itemEmbedText, inquiryEmbedText } from "./lib/embed-text.ts";
import {
  matchNewItem,
  matchNewInquiry,
  rematchPage,
  type RematchPageOutcome,
} from "./lib/matching.ts";
import { runBackgroundAnalysis } from "./lib/analyze-item.ts";
import { arrayBufferToDataUrl, extFromContentType } from "./lib/img.ts";
import { getIdRule, setIdRule, nextDisplayId, previewId, normalizeRule } from "./lib/idrule.ts";
import {
  getLocationPresets,
  setLocationPresets,
  normalizePresets,
} from "./lib/location-presets.ts";
import { verifyAccessJwt } from "./lib/access.ts";
import {
  ITEM_STATUSES,
  INQUIRY_STATUSES,
  getMetaLists,
  getMetaOptions,
  normalizeMetaOptions,
} from "./lib/meta.ts";
import { createItemsCsvStream } from "./lib/items-csv.ts";
import type { SearchFilters } from "./types.ts";
import { DuplicateDisplayIdError } from "./store/index.ts";
import {
  InvalidItemCursorError,
  InvalidItemLimitError,
  parseItemCursor,
  parseItemPageLimit,
  type ItemListOptions,
} from "./store/item-pagination.ts";

/** 現在有効な地図画像のキーを保持する設定キー。 */
const ACTIVE_MAP_KEY = "active_map_key";

/** 再照合の通信断再試行で、同じページを二重処理しないための結果キャッシュ。 */
const REMATCH_CACHE_PREFIX = "rematch_page_cache:";
const REMATCH_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const REMATCH_RUN_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface RematchPageCache {
  expiresAt: number;
  pages: Record<string, RematchPageOutcome>;
}

function isRematchRunId(value: unknown): value is string {
  return typeof value === "string" && REMATCH_RUN_ID_PATTERN.test(value);
}

function rematchCacheKey(runId: string): string {
  return `${REMATCH_CACHE_PREFIX}${runId}`;
}

function isRematchPageOutcome(value: unknown): value is RematchPageOutcome {
  if (!value || typeof value !== "object") return false;
  const page = value as Record<string, unknown>;
  return (
    typeof page.itemsChecked === "number" &&
    typeof page.matchesFound === "number" &&
    typeof page.failed === "number" &&
    (page.nextCursor === null || typeof page.nextCursor === "string") &&
    typeof page.done === "boolean"
  );
}

async function readRematchPageCache(
  store: AppContext["store"],
  runId: string,
): Promise<RematchPageCache> {
  const raw = await store.getSetting(rematchCacheKey(runId));
  if (!raw) return { expiresAt: Date.now() + REMATCH_CACHE_TTL_MS, pages: {} };

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const pages = parsed.pages;
    if (
      typeof parsed.expiresAt !== "number" ||
      parsed.expiresAt <= Date.now() ||
      !pages ||
      typeof pages !== "object" ||
      Array.isArray(pages)
    ) {
      return { expiresAt: Date.now() + REMATCH_CACHE_TTL_MS, pages: {} };
    }

    const validPages: Record<string, RematchPageOutcome> = {};
    for (const [key, value] of Object.entries(pages)) {
      if (isRematchPageOutcome(value)) validPages[key] = value;
    }
    return { expiresAt: parsed.expiresAt, pages: validPages };
  } catch {
    return { expiresAt: Date.now() + REMATCH_CACHE_TTL_MS, pages: {} };
  }
}

function rematchPageCacheKey(cursor: string | undefined): string {
  return cursor ?? "";
}

/**
 * アップロード画像1枚あたりの上限（バイト）。
 * クライアント側で長辺1600px・JPEG品質0.85に正規化してから送っているため
 * 通常は数百KB〜1MB程度だが、それをバイパスする経路（将来の他クライアント等）
 * に備え、R2/AI（Vision）へのコスト爆発を防ぐ安全網としてサーバー側にも上限を設ける。
 */
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10MB

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

function parseItemListOptions(q: Record<string, unknown>): ItemListOptions {
  const createdAt = q.cursorCreatedAt;
  const id = q.cursorId;
  if (createdAt === undefined && id === undefined) {
    return { limit: parseItemPageLimit(q.limit) };
  }
  if (createdAt === undefined || id === undefined) {
    throw new InvalidItemCursorError();
  }
  return {
    cursor: parseItemCursor({ createdAt, id }),
    limit: parseItemPageLimit(q.limit),
  };
}

async function ctx(): Promise<AppContext> {
  return buildContext(getEnv());
}

/** 埋め込み失敗時に呼び出し元の保存処理まで止めないためのラッパー。
 * AI障害時でも「保存はできるがベクトル検索には載らない」状態に留め、
 * 「何もできなくなる」のを避ける。 */
async function safeEmbed(ai: AppContext["ai"], text: string): Promise<number[]> {
  try {
    return await ai.embed(text);
  } catch (e) {
    console.error("[embed] failed, saving without a vector", e);
    return [];
  }
}

export function createApp() {
  // aot(実行時コード生成)は Cloudflare Workers のサンドボックスで禁止されているため無効化。
  const app = new Elysia({ aot: false })
    .onError(({ error, code, set }) => {
      if (error instanceof DuplicateDisplayIdError) {
        set.status = 409;
        return { error: error.code };
      }
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
    // 未設定なら既定リストを返す。並び順・グループ見出し・色タグ込みで返す。
    .get("/api/meta", async () => {
      const c = await ctx();
      const { categories, colors } = await getMetaOptions(c.store);
      return {
        categories,
        colors,
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
      const values = normalizeMetaOptions(raw);
      if (values.length === 0) {
        set.status = 400;
        return { error: "1件以上必要です" };
      }
      await c.store.setSetting(kind, JSON.stringify(values));
      return { values };
    })

    // ---- 拾得場所プリセット（名前 ⇔ 地図ピン位置） ----
    .get("/api/location-presets", async () => {
      const c = await ctx();
      return { presets: await getLocationPresets(c.store) };
    })
    .put("/api/location-presets", async ({ body, set }) => {
      const raw = (body as any)?.presets;
      if (!Array.isArray(raw)) {
        set.status = 400;
        return { error: "presets は配列で指定してください" };
      }
      const c = await ctx();
      const presets = await setLocationPresets(c.store, normalizePresets(raw));
      return { presets };
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
      const tooLarge = files.find((f) => f.size > MAX_UPLOAD_BYTES);
      if (tooLarge) {
        set.status = 413;
        return {
          error: `画像は1枚 ${MAX_UPLOAD_BYTES / 1024 / 1024}MB までです（${tooLarge.name}）`,
        };
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
    .get("/api/images/:key", async ({ params, set, request }) => {
      // 画像キーは crypto.randomUUID() ベースで不変（同じキーの中身が変わることはない）。
      // Cloudflare のエッジキャッシュに直接載せることで、R2/Worker を経由せず
      // colo からそのまま返せるようにする（Bunローカル開発には caches が無いので素通し）。
      const edgeCache = (globalThis as any).caches?.default as Cache | undefined;
      const cacheKey = edgeCache ? new Request(new URL(request.url).toString()) : null;
      if (edgeCache && cacheKey) {
        const hit = await edgeCache.match(cacheKey);
        if (hit) return hit;
      }
      const c = await ctx();
      const obj = await c.images.get(params.key);
      if (!obj) {
        set.status = 404;
        return "not found";
      }
      const res = new Response(new Uint8Array(obj.body), {
        headers: {
          "content-type": obj.contentType,
          "cache-control": "public, max-age=31536000, immutable",
        },
      });
      if (edgeCache && cacheKey) waitUntil(edgeCache.put(cacheKey, res.clone()));
      return res;
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
      if (file.size > MAX_UPLOAD_BYTES) {
        set.status = 413;
        return { error: `地図画像は ${MAX_UPLOAD_BYTES / 1024 / 1024}MB までです` };
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
      const { categories, colors } = await getMetaLists(c.store);
      const result = await c.ai.describeImages(
        dataUrls.map((url) => ({ url })),
        { hint: b.hint, categories, colors },
      );
      return result;
    })

    // ---- items ----
    .get("/api/items", async ({ query, set }) => {
      try {
        const c = await ctx();
        return await c.store.listItems(
          parseFilters(query as Record<string, unknown>),
          parseItemListOptions(query as Record<string, unknown>),
        );
      } catch (error) {
        if (error instanceof InvalidItemCursorError || error instanceof InvalidItemLimitError) {
          set.status = 400;
          return { error: error.message };
        }
        throw error;
      }
    })
    .post("/api/items", async ({ body }) => {
      const c = await ctx();
      const b = (body as any) ?? {};
      const keys: string[] = Array.isArray(b.image_keys) ? b.image_keys : [];
      const draft = {
        status: b.status ?? "stored",
        category: b.category ?? "",
        color: b.color ?? "",
        brand: b.brand ?? "",
        found_location: b.found_location ?? "",
        found_at: b.found_at ?? null,
        map_key: b.map_key ?? "",
        found_x: typeof b.found_x === "number" ? b.found_x : null,
        found_y: typeof b.found_y === "number" ? b.found_y : null,
        image_keys: keys,
        ai_description: b.ai_description ?? "",
        tags: Array.isArray(b.tags) ? b.tags : [],
        notes: b.notes ?? "",
      };
      // 管理番号は設定の採番ルールに従って自動付与（現場・紙台帳での照合用）
      const display_id = b.display_id || (await nextDisplayId(c.store));

      // 画像はあるが特徴文が未指定 → AI解析（vision＋埋め込み＋自動照合）は
      // 現場を待たせないようレスポンスの後ろでバックグラウンド実行する。
      // 一致が見つかった場合は既存の通知の仕組みで届く（この時点の応答には含まれない）。
      if (keys.length > 0 && !draft.ai_description) {
        const item = await c.store.createItem({ ...draft, display_id, ai_status: "pending" });
        waitUntil(runBackgroundAnalysis(c, item));
        return { item, matches: [], topScore: 0 };
      }

      // 画像なし、または呼び出し側が特徴文を渡し済み → 従来通り即時処理。
      // 埋め込みが失敗しても登録自体は必ず成立させる（AI障害で登録がブロックされないように）。
      const embedding = await safeEmbed(c.ai, itemEmbedText(draft));
      const item = await c.store.createItem({
        ...draft,
        display_id,
        embedding,
        ai_status: embedding.length ? "ready" : "error",
      });
      item.embedding = embedding; // pg/D1 実装は embedding を返さないため補完
      const outcome =
        item.status === "stored" && embedding.length
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
      // 特徴に関わる項目が変わったら再埋め込み。
      // 埋め込みが失敗しても、他のフィールドの編集（状態変更など）まで巻き込んで
      // 失敗にしない — 埋め込みだけ古いまま保持し、ai_status で要再解析を示す。
      const touchesFeatures = [
        "category",
        "color",
        "brand",
        "ai_description",
        "tags",
        "found_location",
        "notes",
      ].some((k) => k in patch);
      let embedding: number[] | undefined;
      let ai_status: typeof existing.ai_status | undefined;
      if (touchesFeatures) {
        embedding = await safeEmbed(c.ai, itemEmbedText({ ...existing, ...patch }));
        // 再埋め込みが成功したら「AI解析失敗」表示を解除する（以前は失敗時しか
        // ai_status を書き換えず、再解析→保存が成功しても error のまま残っていた）。
        ai_status = embedding.length ? "ready" : "error";
        if (!embedding.length) embedding = undefined;
      }
      const updated = await c.store.updateItem(params.id, {
        ...patch,
        ...(embedding ? { embedding } : {}),
        ...(ai_status ? { ai_status } : {}),
      });
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
        const page = await c.store.listItems(filters, { limit: filters.limit ?? 50 });
        return { items: page.items.map((i) => ({ ...i, score: null })) };
      }
      const embedding = await safeEmbed(c.ai, filters.q);
      if (!embedding.length) {
        // AI障害時は特徴文検索を諦め、フィルタだけの一覧にフォールバック
        // （検索自体を丸ごとエラーにしない）。degraded を立てて呼び出し側に
        // 「ベクトル検索はできていない」ことを伝える（何も伝えないと検索してるのに
        // スコアが出ず、壊れているようにしか見えない）。
        const page = await c.store.listItems(filters, { limit: filters.limit ?? 50 });
        return { items: page.items.map((i) => ({ ...i, score: null })), degraded: true };
      }
      const items = await c.store.searchItems(embedding, filters);
      return { items };
    })

    // ---- ページ単位の全件再照合（管理画面の手動トリガー） ----
    // 管理画面がカーソルを引き継ぎ、100件ずつ終端まで順番に呼び出す。
    .post("/api/rematch", async ({ body, set }) => {
      const payload = (body as { cursor?: unknown; runId?: unknown } | undefined) ?? {};
      const cursor = payload.cursor;
      if (cursor !== undefined && (typeof cursor !== "string" || !cursor)) {
        set.status = 400;
        return { error: "invalid_cursor" };
      }
      const runId =
        payload.runId === undefined
          ? undefined
          : isRematchRunId(payload.runId)
            ? payload.runId
            : null;
      if (runId === null) {
        set.status = 400;
        return { error: "invalid_run_id" };
      }

      try {
        const c = await ctx();
        if (!runId) return await rematchPage(c.store, c.ai, c.cfg.matchThreshold, cursor);

        const cache = await readRematchPageCache(c.store, runId);
        const pageKey = rematchPageCacheKey(cursor);
        const cached = cache.pages[pageKey];
        if (cached) return cached;

        const outcome = await rematchPage(c.store, c.ai, c.cfg.matchThreshold, cursor);
        cache.pages[pageKey] = outcome;
        await c.store.setSetting(rematchCacheKey(runId), JSON.stringify(cache));
        return outcome;
      } catch (error) {
        if (error instanceof InvalidItemCursorError) {
          set.status = 400;
          return { error: error.message };
        }
        throw error;
      }
    })
    .post("/api/rematch/finish", async ({ body, set }) => {
      const runId = (body as { runId?: unknown } | undefined)?.runId;
      if (!isRematchRunId(runId)) {
        set.status = 400;
        return { error: "invalid_run_id" };
      }
      const c = await ctx();
      // 終了通知が失われてもTTLで回収できるよう、削除は補助的に行う。
      await c.store.setSetting(rematchCacheKey(runId), "");
      return { ok: true };
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
      // 埋め込みが失敗しても、問い合わせの記録自体は必ず保存する。
      const embedding = await safeEmbed(c.ai, inquiryEmbedText(draft));
      const inquiry = await c.store.createInquiry({ ...draft, embedding });
      inquiry.embedding = embedding;
      const outcome = embedding.length
        ? await matchNewInquiry(c.store, inquiry, c.cfg.matchThreshold)
        : { matches: [], topScore: 0 };
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
      if (touches) {
        // 失敗しても他フィールドの編集は保存する（埋め込みだけ古いまま据え置く）。
        const e = await safeEmbed(c.ai, inquiryEmbedText({ ...existing, ...patch }));
        if (e.length) embedding = e;
      }
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
        await c.store.updateInquiry(m.inquiry_id, {
          status: "resolved",
          matched_item_id: m.item_id,
        });
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

    // ---- 物品CSV出力 ----
    .get("/api/export/items.csv", async ({ query }) => {
      const c = await ctx();
      return new Response(createItemsCsvStream(c.store, parseFilters(query as any)), {
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": 'attachment; filename="items.csv"',
        },
      });
    });

  return app;
}

export type App = ReturnType<typeof createApp>;
