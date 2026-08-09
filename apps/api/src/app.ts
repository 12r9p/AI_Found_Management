import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { buildContext, type AppContext } from "./context.ts";
import { getEnv, waitUntil } from "./env-holder.ts";
import { itemEmbedText, inquiryEmbedText } from "./lib/embed-text.ts";
import {
  matchNewItem,
  matchNewInquiry,
  rematchPage,
  categoryRelation,
  hasExplicitObjectTypeTextConflict,
  hasExplicitObjectTypeTextMatch,
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
import { inferQueryFilters } from "./lib/query-filters.ts";
import {
  configuredOption,
  inquiryImportFingerprint,
  parseInquiryCsv,
} from "./lib/inquiry-import.ts";
import { normalizeFoundDateRange } from "./lib/date-filters.ts";
import { eventBus, type AppEvent } from "./lib/events.ts";
import type { SearchFilters } from "./types.ts";
import {
  calculateThresholdStats,
  getEffectiveThreshold,
  MATCH_THRESHOLD_SETTING_KEY,
} from "./lib/threshold-stats.ts";
import { DuplicateDisplayIdError, VectorMetadataSyncError } from "./store/index.ts";
import {
  InvalidItemCursorError,
  InvalidItemLimitError,
  isItemCursorPosition,
  parseItemCursor,
  parseItemPageLimit,
  type ItemCursorPosition,
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
    (page.nextCursor === null || isItemCursorPosition(page.nextCursor)) &&
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

function rematchPageCacheKey(cursor: ItemCursorPosition | undefined): string {
  return JSON.stringify(cursor ?? null);
}

/**
 * アップロード画像1枚あたりの上限（バイト）。
 * クライアント側で長辺1600px・JPEG品質0.85に正規化してから送っているため
 * 通常は数百KB〜1MB程度だが、それをバイパスする経路（将来の他クライアント等）
 * に備え、R2/AI（Vision）へのコスト爆発を防ぐ安全網としてサーバー側にも上限を設ける。
 */
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10MB
const MAX_INQUIRY_IMPORT_BYTES = 2 * 1024 * 1024;
const MAX_INQUIRY_IMPORT_ROWS = 500;

function parseFilters(q: Record<string, any>): SearchFilters {
  const dateRange = normalizeFoundDateRange(q.from || undefined, q.to || undefined);
  return {
    q: q.q || undefined,
    display_id: q.display_id || undefined,
    category: q.category || undefined,
    color: q.color || undefined,
    status: q.status || undefined,
    location: q.location || undefined,
    ...dateRange,
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

/** 同値PATCHをVectorize同期失敗後の再試行にも使えるよう、指定項目の有無で判定する。 */
function touchesAnyField(patch: Record<string, unknown>, fields: readonly string[]): boolean {
  return fields.some((field) => field in patch);
}

async function defaultContext(): Promise<AppContext> {
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

/**
 * 編集内容は先にD1へ保存し、時間のかかる埋め込み・Vectorize同期・再照合は
 * レスポンス送出後に行う。処理失敗は保存済みデータをロールバックしない。
 */
async function refreshItemVector(c: AppContext, id: string, shouldEmbed: boolean): Promise<void> {
  const item = await c.store.getItem(id);
  if (!item) return;

  if (!shouldEmbed) {
    await c.store.updateItem(id, { status: item.status });
    return;
  }

  const embedding = await safeEmbed(c.ai, itemEmbedText(item));
  if (!embedding.length) {
    await c.store.updateItem(id, {
      status: item.status,
      category: item.category,
      ai_status: "error",
    });
    return;
  }

  const updated = await c.store.updateItem(id, { embedding, ai_status: "ready" });
  if (updated?.status === "stored") {
    updated.embedding = embedding;
    await matchNewItem(c.store, updated, c.cfg.matchThreshold, c.ai);
  }
}

async function refreshInquiryVector(
  c: AppContext,
  id: string,
  shouldEmbed: boolean,
): Promise<void> {
  const inquiry = await c.store.getInquiry(id);
  if (!inquiry) return;

  if (!shouldEmbed) {
    await c.store.updateInquiry(id, { status: inquiry.status });
    return;
  }

  const embedding = await safeEmbed(c.ai, inquiryEmbedText(inquiry));
  const updated = await c.store.updateInquiry(
    id,
    embedding.length ? { embedding } : { status: inquiry.status, category: inquiry.category },
  );
  if (updated && embedding.length && (updated.status === "open" || updated.status === "matched")) {
    updated.embedding = embedding;
    await matchNewInquiry(c.store, updated, c.cfg.matchThreshold, c.ai);
  }
}

function runAfterSave(task: Promise<void>, entity: "item" | "inquiry", id: string): void {
  waitUntil(
    task.catch((error) => {
      console.error(
        JSON.stringify({
          event: "post_save_vector_refresh_failed",
          entity,
          id,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }),
  );
}

export function createApp(resolveContext: () => Promise<AppContext> = defaultContext) {
  const ctx = resolveContext;
  // aot(実行時コード生成)は Cloudflare Workers のサンドボックスで禁止されているため無効化。
  const app = new Elysia({ aot: false })
    .onError(({ error, code, set }) => {
      if (error instanceof DuplicateDisplayIdError) {
        set.status = 409;
        return { error: error.code };
      }
      if (error instanceof VectorMetadataSyncError) {
        set.status = 503;
        return { error: error.code, applied: error.applied };
      }
      const message = error instanceof Error ? error.message : String(error);
      console.error(JSON.stringify({ event: "api_error", code, error: message }));
      if (code === "NOT_FOUND") {
        set.status = 404;
        return { error: "not_found" };
      }
      set.status = 500;
      return { error: "internal_error" };
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
    .get("/api/events", ({ request }) => {
      let unsubscribe: (() => void) | undefined;
      let timer: ReturnType<typeof setInterval> | undefined;

      const stream = new ReadableStream({
        start(controller) {
          const encoder = new TextEncoder();

          const sendEvent = (event: AppEvent) => {
            try {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
            } catch {
              // Stream is closed
            }
          };

          timer = setInterval(() => {
            sendEvent({ type: "ping", data: { timestamp: new Date().toISOString() } });
          }, 15000);

          unsubscribe = eventBus.subscribe((event) => {
            sendEvent(event);
          });

          sendEvent({ type: "ping", data: { timestamp: new Date().toISOString() } });

          request.signal.addEventListener("abort", () => {
            if (timer) clearInterval(timer);
            if (unsubscribe) unsubscribe();
            try {
              controller.close();
            } catch {
              // Already closed
            }
          });
        },
        cancel() {
          if (timer) clearInterval(timer);
          if (unsubscribe) unsubscribe();
        },
      });

      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        },
      });
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
    .get("/api/images/:key", async ({ set, request }) => {
      // 開発・本番ともAPIを認証境界にし、画像WorkerへService Bindingで転送する。
      const imageWorker = getEnv().IMAGE_WORKER;
      if (!imageWorker) {
        set.status = 503;
        return { error: "image_worker_unavailable" };
      }
      try {
        return await imageWorker.fetch(request);
      } catch (error) {
        console.error(`[image-worker] proxy failed: ${String(error)}`);
        set.status = 503;
        return { error: "image_worker_unavailable" };
      }
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
    .post("/api/items", async ({ body, set }) => {
      const c = await ctx();
      const b = (body as any) ?? {};
      const keys: string[] = Array.isArray(b.image_keys) ? b.image_keys : [];
      // 画像なしの登録は現場での照合に使えないため必須化。
      if (keys.length === 0) {
        set.status = 400;
        return { error: "image_required" };
      }
      const storage_location =
        typeof b.storage_location === "string" ? b.storage_location.trim() : "";
      if (!storage_location) {
        set.status = 400;
        return { error: "storage_location_required" };
      }
      const draft = {
        status: b.status ?? "stored",
        category: b.category ?? "",
        color: b.color ?? "",
        brand: b.brand ?? "",
        storage_location,
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

      // 呼び出し側が特徴文を渡し済み → 従来通り即時処理。
      // 埋め込みが失敗しても登録自体は必ず成立させる（AI障害で登録がブロックされないように）。
      const embedding = await safeEmbed(c.ai, itemEmbedText(draft));
      const item = await c.store.createItem({
        ...draft,
        display_id,
        embedding,
        ai_status: embedding.length ? "ready" : "error",
      });
      item.embedding = embedding; // pg/D1 実装は embedding を返さないため補完
      const threshold = await getEffectiveThreshold(c.store, c.cfg.matchThreshold);
      const outcome =
        item.status === "stored" && embedding.length
          ? await matchNewItem(c.store, item, threshold, c.ai)
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
      if (Object.hasOwn(patch, "storage_location")) {
        patch.storage_location =
          typeof patch.storage_location === "string" ? patch.storage_location.trim() : "";
        if (!patch.storage_location) {
          set.status = 400;
          return { error: "storage_location_required" };
        }
      }
      // 埋め込み対象の項目を含むPATCHは、同値でも再埋め込みする。
      // D1更新後にVectorize upsertが失敗した場合、同じPATCHを再送して古いvector値を
      // 修復できる必要がある。categoryは埋め込み本文とmetadataの両方に含まれる。
      // 埋め込みが失敗しても、他のフィールドの編集（状態変更など）まで巻き込んで
      // 失敗にしない — 埋め込みだけ古いまま保持し、ai_status で要再解析を示す。
      const touchesFeatures = touchesAnyField(patch, [
        "category",
        "color",
        "brand",
        "ai_description",
        "tags",
        "found_location",
        "notes",
      ]);
      // 永続データの書き込み成功をもって応答する。埋め込み・Vectorize同期は
      // Workerのバックグラウンド処理へ分離し、編集モーダルを待たせない。
      const updated = await c.store.updateItem(params.id, patch, { syncVector: false });
      runAfterSave(refreshItemVector(c, params.id, touchesFeatures), "item", params.id);
      return { item: updated };
    })
    .delete("/api/items/:id", async ({ params }) => {
      const c = await ctx();
      const deletedItem = await c.store.deleteItem(params.id);
      if (deletedItem) {
        const cleanupResults = await Promise.allSettled(
          deletedItem.image_keys.map((key) => c.images.delete(key)),
        );
        cleanupResults.forEach((result, index) => {
          if (result.status === "fulfilled") return;
          console.error(
            JSON.stringify({
              event: "deletion_cleanup_failed",
              resource: "r2_image",
              entityId: deletedItem.id,
              objectKey: deletedItem.image_keys[index],
              applied: true,
              error: result.reason instanceof Error ? result.reason.message : String(result.reason),
            }),
          );
        });
      }
      return { deleted: deletedItem !== null };
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
      // 採番ルールは設定で変更できるため形式を決め打ちせず、検索文全体を管理番号として
      // 先に部分一致検索する。該当する場合はAIを使わず、管理番号の結果を優先する。
      const displayIdQuery = filters.q.trim();
      if (displayIdQuery) {
        const displayIdPage = await c.store.listItems(
          { ...filters, q: undefined, display_id: displayIdQuery },
          { limit: filters.limit ?? 50 },
        );
        if (displayIdPage.items.length > 0) {
          return {
            items: displayIdPage.items.map((item) => ({ ...item, score: null })),
            inferredFilters: { category: "", color: "" },
          };
        }
      }
      const { categories, colors } = await getMetaLists(c.store);
      const inferredFilters = await inferQueryFilters(c.ai, filters.q, categories, colors);
      const embedding = await safeEmbed(c.ai, filters.q);
      if (!embedding.length) {
        // AI障害時は特徴文検索を諦め、フィルタだけの一覧にフォールバック
        // （検索自体を丸ごとエラーにしない）。degraded を立てて呼び出し側に
        // 「ベクトル検索はできていない」ことを伝える（何も伝えないと検索してるのに
        // スコアが出ず、壊れているようにしか見えない）。
        const page = await c.store.listItems(filters, { limit: filters.limit ?? 50 });
        return {
          items: page.items.map((i) => ({ ...i, score: null })),
          degraded: true,
          inferredFilters,
        };
      }
      const items = (await c.store.searchItems(embedding, filters)).filter((item) => {
        if (item.score < c.cfg.searchThreshold) return false;
        if (!filters.category && inferredFilters.category) {
          const relation = categoryRelation(item.category, inferredFilters.category);
          if (relation === "incompatible") return false;
          // 「その他」やカテゴリ空欄を救済するのは、特徴文にも同じ物品名がある場合だけ。
          // タオル検索で説明の薄い無関係な「その他」が混ざるのを防ぐ。
          if (
            relation === "broad" &&
            !hasExplicitObjectTypeTextMatch(
              [item.ai_description, ...item.tags].filter(Boolean).join(" "),
              filters.q ?? "",
            )
          ) {
            return false;
          }
        }
        if (
          !filters.color &&
          inferredFilters.color &&
          item.color &&
          item.color !== inferredFilters.color
        ) {
          return false;
        }
        return !hasExplicitObjectTypeTextConflict(
          [item.ai_description, ...item.tags].filter(Boolean).join(" "),
          filters.q ?? "",
        );
      });
      return { items, inferredFilters };
    })

    // ---- ページ単位の全件再照合（管理画面の手動トリガー） ----
    // 管理画面がカーソルを引き継ぎ、100件ずつ終端まで順番に呼び出す。
    .post("/api/rematch", async ({ body, set }) => {
      const payload = (body as { cursor?: unknown; runId?: unknown } | undefined) ?? {};
      let cursor: ItemCursorPosition | undefined;
      try {
        cursor = payload.cursor === undefined ? undefined : parseItemCursor(payload.cursor);
      } catch {
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
      const description = typeof b.description === "string" ? b.description : "";
      const { categories, colors } = await getMetaLists(c.store);
      const inferredFilters = await inferQueryFilters(c.ai, description, categories, colors);
      const requestedCategory = typeof b.category === "string" ? b.category.trim() : "";
      const requestedColor = typeof b.color === "string" ? b.color.trim() : "";
      const category = requestedCategory || inferredFilters.category;
      const color = requestedColor || inferredFilters.color;
      const draft = {
        status: "open" as const,
        description,
        category,
        color,
        ai_description: description,
        tags: Array.isArray(b.tags) ? b.tags : [],
        reference_no: b.reference_no ?? "",
        notes: b.notes ?? "",
      };
      // 埋め込みが失敗しても、問い合わせの記録自体は必ず保存する。
      const embedding = await safeEmbed(c.ai, inquiryEmbedText(draft));
      const inquiry = await c.store.createInquiry({ ...draft, embedding });
      inquiry.embedding = embedding;
      const threshold = await getEffectiveThreshold(c.store, c.cfg.matchThreshold);
      const outcome = embedding.length
        ? await matchNewInquiry(c.store, inquiry, threshold, c.ai)
        : { matches: [], topScore: 0 };
      return {
        inquiry,
        matches: outcome.matches,
        topScore: outcome.topScore,
        inferredFilters: {
          category: requestedCategory ? "" : inferredFilters.category,
          color: requestedColor ? "" : inferredFilters.color,
        },
      };
    })
    .post("/api/inquiries/import", async ({ body, set }) => {
      const c = await ctx();
      const values = body && typeof body === "object" ? Object.values(body as object) : [];
      const file = values.find((value): value is File => value instanceof File);
      if (!file) {
        set.status = 400;
        return { error: "csv_file_required" };
      }
      if (file.size > MAX_INQUIRY_IMPORT_BYTES) {
        set.status = 413;
        return { error: "csv_file_too_large" };
      }

      let rows;
      try {
        rows = parseInquiryCsv(await file.text());
      } catch (error) {
        set.status = 400;
        return { error: error instanceof Error ? error.message : "invalid_csv" };
      }
      if (rows.length > MAX_INQUIRY_IMPORT_ROWS) {
        set.status = 400;
        return { error: "too_many_rows", maxRows: MAX_INQUIRY_IMPORT_ROWS };
      }

      const { categories, colors } = await getMetaLists(c.store);
      const existing = await c.store.listInquiries();
      const fingerprints = new Set(
        existing.map((inquiry) =>
          inquiryImportFingerprint(inquiry.reference_no, inquiry.description),
        ),
      );
      const result = {
        total: rows.length,
        imported: 0,
        skipped: 0,
        failed: 0,
        matchesCreated: 0,
        warnings: [] as { row: number; message: string }[],
        errors: [] as { row: number; message: string }[],
      };

      // AI APIのレート制限と通知の順序を安定させるため、行単位で順番に保存・照合する。
      for (const row of rows) {
        if (!row.description) {
          result.failed++;
          result.errors.push({ row: row.rowNumber, message: "特徴が空です" });
          continue;
        }
        const fingerprint = inquiryImportFingerprint(row.referenceNo, row.description);
        if (fingerprints.has(fingerprint)) {
          result.skipped++;
          continue;
        }
        const configuredCategory = configuredOption(row.category, categories);
        const configuredColor = configuredOption(row.color, colors);
        const inferredFilters =
          configuredCategory && configuredColor
            ? { category: "", color: "" }
            : await inferQueryFilters(c.ai, row.description, categories, colors);
        const category = configuredCategory || inferredFilters.category;
        const color = configuredColor || inferredFilters.color;
        if (row.category && !configuredCategory) {
          result.warnings.push({
            row: row.rowNumber,
            message: `未登録カテゴリ「${row.category}」は${category ? `「${category}」へ自動補完` : "未指定として取込"}しました`,
          });
        }
        if (row.color && !configuredColor) {
          result.warnings.push({
            row: row.rowNumber,
            message: `未登録色「${row.color}」は${color ? `「${color}」へ自動補完` : "未指定として取込"}しました`,
          });
        }
        const draft = {
          status: "open" as const,
          description: row.description,
          category,
          color,
          ai_description: row.description,
          tags: row.tags,
          reference_no: row.referenceNo,
          notes: row.notes,
        };
        try {
          const embedding = await safeEmbed(c.ai, inquiryEmbedText(draft));
          const inquiry = await c.store.createInquiry({ ...draft, embedding });
          inquiry.embedding = embedding;
          if (embedding.length) {
            const outcome = await matchNewInquiry(c.store, inquiry, c.cfg.matchThreshold, c.ai);
            result.matchesCreated += outcome.matches.length;
          } else {
            result.warnings.push({
              row: row.rowNumber,
              message: "問い合わせは保存しましたがAI照合を実行できませんでした",
            });
          }
          fingerprints.add(fingerprint);
          result.imported++;
        } catch (error) {
          result.failed++;
          result.errors.push({
            row: row.rowNumber,
            message: error instanceof Error ? error.message : "import_failed",
          });
        }
      }
      return result;
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
      // categoryは埋め込み本文にも含まれるため、同値の再試行を含めて再埋め込みする。
      const touches = touchesAnyField(patch, ["category", "color", "description", "tags", "notes"]);
      const updated = await c.store.updateInquiry(params.id, patch, { syncVector: false });
      runAfterSave(refreshInquiryVector(c, params.id, touches), "inquiry", params.id);
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
      const status = (body as any)?.status;
      if (status !== "confirmed" && status !== "rejected") {
        set.status = 400;
        return { error: "invalid_match_status" };
      }

      const result = await c.store.decideMatch(params.id, status);
      if (!result.ok && result.reason === "not_found") {
        set.status = 404;
        return { error: "not found" };
      }
      if (!result.ok) {
        set.status = 409;
        return { error: "match_confirmation_conflict" };
      }
      return { match: result.match, inquiry: result.inquiry };
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
    })

    // ---- 統計・適正しきい値算出 ----
    .get("/api/stats/threshold", async () => {
      const c = await ctx();
      return await calculateThresholdStats(c.store, c.cfg.matchThreshold);
    })
    .post("/api/stats/threshold", async ({ body, set }) => {
      const c = await ctx();
      const threshold = (body as any)?.threshold;
      if (
        typeof threshold !== "number" ||
        Number.isNaN(threshold) ||
        threshold < 0.1 ||
        threshold > 0.95
      ) {
        set.status = 400;
        return { error: "invalid_threshold" };
      }
      await c.store.setSetting(MATCH_THRESHOLD_SETTING_KEY, String(threshold));
      const stats = await calculateThresholdStats(c.store, c.cfg.matchThreshold);
      return { ok: true, stats };
    });

  return app;
}

export type App = ReturnType<typeof createApp>;
