import { Elysia, t } from "elysia";
import { cors } from "@elysiajs/cors";
import { openapi } from "@elysia/openapi";
import { buildContext, type AppContext } from "./context.ts";
import {
  detail,
  IdRuleSchema,
  InquiryDtoSchema,
  InquiryStatusSchema,
  InquiryWriteSchema,
  ItemCursorSchema,
  ItemDtoSchema,
  ItemStatusSchema,
  ItemWriteSchema,
  LocationPresetSchema,
  MatchDtoSchema,
  MatchStatusSchema,
  MetaOptionSchema,
  NotificationDtoSchema,
  nullable,
  responses,
  SearchFiltersSchema,
} from "./contracts.ts";
import { toInquiryDto, toItemDto } from "./dto.ts";
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
import { DuplicateDisplayIdError, VectorMetadataSyncError } from "./store/index.ts";
import {
  isItemCursorPosition,
  type ItemCursorPosition,
  type ItemListOptions,
} from "./store/item-pagination.ts";

/** 現在有効な地図画像のキーを保持する設定キー。 */
const ACTIVE_MAP_KEY = "active_map_key";

/** 再照合の通信断再試行で、同じページを二重処理しないための結果キャッシュ。 */
const REMATCH_CACHE_PREFIX = "rematch_page_cache:";
const REMATCH_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

interface RematchPageCache {
  expiresAt: number;
  pages: Record<string, RematchPageOutcome>;
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

  const updated = await c.store.updateItem(id, {
    embedding,
    ai_status: "ready",
  });
  if (updated?.status === "stored") {
    updated.embedding = embedding;
    await matchNewItem(c.store, updated, c.cfg.matchThreshold);
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
  await c.store.updateInquiry(
    id,
    embedding.length ? { embedding } : { status: inquiry.status, category: inquiry.category },
  );
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

export interface CreateAppOptions {
  openApiEnabled?: boolean;
}

export function createApp(
  resolveContext: () => Promise<AppContext> = defaultContext,
  options: CreateAppOptions = {},
) {
  const ctx = resolveContext;
  // aot(実行時コード生成)は Cloudflare Workers のサンドボックスで禁止されているため無効化。
  const app = new Elysia({ aot: false })
    .use(
      openapi({
        enabled: options.openApiEnabled === true,
        exclude: { staticFile: false },
        documentation: {
          info: {
            title: "遺失物管理API",
            version: "1.0.0",
            description: "遺失物・問い合わせ・照合・通知を管理する内部API。",
          },
          tags: [
            { name: "システム", description: "稼働状態" },
            { name: "設定", description: "選択肢と採番ルール" },
            { name: "画像", description: "画像の保存と配信" },
            { name: "地図", description: "拾得場所入力用の地図" },
            { name: "AI", description: "画像の特徴抽出" },
            { name: "遺失物", description: "遺失物の登録・検索・出力" },
            { name: "検索", description: "特徴検索" },
            { name: "問い合わせ", description: "問い合わせの登録と管理" },
            { name: "照合", description: "遺失物と問い合わせの照合" },
            { name: "通知", description: "照合通知" },
          ],
        },
      }),
    )
    .onError(({ error, code, set }) => {
      const message = error instanceof Error ? error.message : String(error);
      if (
        message === "invalid_cursor" ||
        message === "invalid_limit" ||
        message === "invalid_run_id" ||
        message === "invalid_match_status"
      ) {
        set.status = 400;
        return { error: message };
      }
      if (code === "VALIDATION") {
        set.status = 400;
        return { error: "invalid_request" };
      }
      if (error instanceof DuplicateDisplayIdError) {
        set.status = 409;
        return { error: error.code };
      }
      if (error instanceof VectorMetadataSyncError) {
        set.status = 503;
        return { error: error.code, applied: error.applied };
      }
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
    .get("/", () => ({ name: "found-api", ok: true }), {
      response: responses(t.Object({ name: t.String(), ok: t.Boolean() })),
      detail: detail("API情報を取得", "APIの識別情報と稼働状態を返す。", ["システム"]),
    })
    .get(
      "/api/health",
      async () => {
        const c = await ctx();
        return {
          ok: true,
          store: c.store.kind,
          ai: c.ai.name,
          matchThreshold: c.cfg.matchThreshold,
          embedDim: c.cfg.ai.embedDim,
          accessProtected: c.cfg.access.enabled,
        };
      },
      {
        response: responses(
          t.Object({
            ok: t.Boolean(),
            store: t.String(),
            ai: t.String(),
            matchThreshold: t.Number(),
            embedDim: t.Number(),
            accessProtected: t.Boolean(),
          }),
        ),
        detail: detail("ヘルスチェック", "DB・AI・Access設定を含む稼働状態を返す。", ["システム"]),
      },
    )
    // 種別・色はスタッフが設定画面から編集できる（現場ごとに扱う物品が違うため）。
    // 未設定なら既定リストを返す。並び順・グループ見出し・色タグ込みで返す。
    .get(
      "/api/meta",
      async () => {
        const c = await ctx();
        const { categories, colors } = await getMetaOptions(c.store);
        return {
          categories,
          colors,
          itemStatuses: [...ITEM_STATUSES],
          inquiryStatuses: [...INQUIRY_STATUSES],
        };
      },
      {
        response: responses(
          t.Object({
            categories: t.Array(MetaOptionSchema),
            colors: t.Array(MetaOptionSchema),
            itemStatuses: t.Array(ItemStatusSchema),
            inquiryStatuses: t.Array(InquiryStatusSchema),
          }),
        ),
        detail: detail("選択肢を取得", "種別・色・状態の選択肢を表示順どおり返す。", ["設定"]),
      },
    )
    .put(
      "/api/meta/:kind",
      async ({ params, body }) => {
        const kind = params.kind;
        const c = await ctx();
        const values = normalizeMetaOptions(body.values);
        await c.store.setSetting(kind, JSON.stringify(values));
        return { values };
      },
      {
        params: t.Object({
          kind: t.Union([t.Literal("categories"), t.Literal("colors")], {
            error: "categories か colors のみ変更できます",
          }),
        }),
        body: t.Object({
          values: t.Array(MetaOptionSchema, { minItems: 1, maxItems: 200 }),
        }),
        response: responses(t.Object({ values: t.Array(MetaOptionSchema) })),
        detail: detail("選択肢を更新", "種別または色の選択肢を並び順込みで保存する。", ["設定"]),
      },
    )

    // ---- 拾得場所プリセット（名前 ⇔ 地図ピン位置） ----
    .get(
      "/api/location-presets",
      async () => {
        const c = await ctx();
        return { presets: await getLocationPresets(c.store) };
      },
      {
        response: responses(t.Object({ presets: t.Array(LocationPresetSchema) })),
        detail: detail("拾得場所プリセットを取得", "地図上の多角形と名称の組を返す。", ["設定"]),
      },
    )
    .put(
      "/api/location-presets",
      async ({ body }) => {
        const c = await ctx();
        const presets = await setLocationPresets(c.store, normalizePresets(body.presets));
        return { presets };
      },
      {
        body: t.Object({
          presets: t.Array(LocationPresetSchema, { maxItems: 100 }),
        }),
        response: responses(t.Object({ presets: t.Array(LocationPresetSchema) })),
        detail: detail("拾得場所プリセットを更新", "地図上の多角形と名称の組を保存する。", [
          "設定",
        ]),
      },
    )

    // ---- 管理番号の採番ルール ----
    .get(
      "/api/id-rule",
      async () => {
        const c = await ctx();
        const rule = await getIdRule(c.store);
        return { rule, preview: previewId(rule) };
      },
      {
        response: responses(t.Object({ rule: IdRuleSchema, preview: t.String() })),
        detail: detail("採番ルールを取得", "管理番号の採番ルールとプレビューを返す。", ["設定"]),
      },
    )
    .put(
      "/api/id-rule",
      async ({ body }) => {
        const c = await ctx();
        const rule = await setIdRule(c.store, normalizeRule(body.rule));
        return { rule, preview: previewId(rule) };
      },
      {
        body: t.Object({ rule: IdRuleSchema }),
        response: responses(t.Object({ rule: IdRuleSchema, preview: t.String() })),
        detail: detail("採番ルールを更新", "管理番号の採番ルールを正規化して保存する。", ["設定"]),
      },
    )

    // ---- uploads / images ----
    .post(
      "/api/uploads",
      async ({ body, set }) => {
        const c = await ctx();
        const files = [body.image0, body.image1].filter((file): file is File => file !== undefined);
        if (files.length === 0) {
          set.status = 400;
          return {
            error: "画像ファイルがありません（multipart/form-data で送信してください）",
          };
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
      },
      {
        body: t.Object({
          image0: t.Optional(t.File()),
          image1: t.Optional(t.File()),
        }),
        response: responses(t.Object({ keys: t.Array(t.String(), { maxItems: 2 }) })),
        detail: detail("遺失物画像をアップロード", "最大2枚の画像を保存し画像キーを返す。", [
          "画像",
        ]),
      },
    )
    .get(
      "/api/images/:key",
      async ({ set, request }) => {
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
      },
      {
        params: t.Object({ key: t.String({ minLength: 1 }) }),
        query: t.Object({
          variant: t.Optional(
            t.Union([t.Literal("thumb"), t.Literal("preview"), t.Literal("original")]),
          ),
        }),
        response: responses(t.Unknown({ description: "画像Workerが返す画像バイナリ" })),
        detail: detail("画像を取得", "認証後に画像Workerへ転送し、指定variantの画像を返す。", [
          "画像",
        ]),
      },
    )

    // ---- 地図（拾得場所のピン留め用） ----
    .get(
      "/api/map",
      async () => {
        const c = await ctx();
        const key = await c.store.getSetting(ACTIVE_MAP_KEY);
        return { key: key ?? "" };
      },
      {
        response: responses(t.Object({ key: t.String() })),
        detail: detail("地図画像を取得", "現在有効な地図画像キーを返す。", ["地図"]),
      },
    )
    .post(
      "/api/map",
      async ({ body, set }) => {
        const c = await ctx();
        const file = body.map;
        if (!file) {
          set.status = 400;
          return { error: "地図画像がありません（multipart/form-data）" };
        }
        if (file.size > MAX_UPLOAD_BYTES) {
          set.status = 413;
          return {
            error: `地図画像は ${MAX_UPLOAD_BYTES / 1024 / 1024}MB までです`,
          };
        }
        const ct = file.type || "image/png";
        const key = `map_${crypto.randomUUID()}.${extFromContentType(ct)}`;
        await c.images.put(key, await file.arrayBuffer(), ct);
        await c.store.setSetting(ACTIVE_MAP_KEY, key);
        return { key };
      },
      {
        body: t.Object({ map: t.Optional(t.File()) }),
        response: responses(t.Object({ key: t.String() })),
        detail: detail("地図画像を更新", "拾得場所入力に使う地図画像を保存する。", ["地図"]),
      },
    )

    // ---- AI analyze (tagging) ----
    .post(
      "/api/analyze",
      async ({ body }) => {
        const c = await ctx();
        const b = body;
        const dataUrls = [...(b.dataUrls ?? [])];
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
      },
      {
        body: t.Object({
          keys: t.Optional(t.Array(t.String(), { maxItems: 2 })),
          dataUrls: t.Optional(t.Array(t.String(), { maxItems: 2 })),
          hint: t.Optional(t.String()),
        }),
        response: responses(
          t.Object({
            description: t.String(),
            tags: t.Array(t.String()),
            category: t.String(),
            color: t.String(),
            brand: t.String(),
          }),
        ),
        detail: detail("画像の特徴を解析", "画像から照合用の特徴文・タグ・種別・色を抽出する。", [
          "AI",
        ]),
      },
    )

    // ---- items ----
    .get(
      "/api/items",
      async ({ query }) => {
        const c = await ctx();
        const filters: SearchFilters = {
          q: query.q,
          category: query.category,
          color: query.color,
          status: query.status,
          location: query.location,
          from: query.from,
          to: query.to,
          limit: query.limit,
        };
        const options: ItemListOptions =
          query.cursorCreatedAt !== undefined && query.cursorId !== undefined
            ? {
                cursor: {
                  createdAt: query.cursorCreatedAt,
                  id: query.cursorId,
                },
                limit: query.limit,
              }
            : { limit: query.limit };
        const page = await c.store.listItems(filters, options);
        return { ...page, items: page.items.map(toItemDto) };
      },
      {
        query: t
          .Transform(
            t.Object({
              ...SearchFiltersSchema.properties,
              limit: t.Optional(t.Numeric({ minimum: 1, maximum: 200, error: "invalid_limit" })),
              cursorCreatedAt: t.Optional(t.String({ format: "date-time" })),
              cursorId: t.Optional(t.String({ minLength: 1 })),
            }),
          )
          .Decode((query) => {
            if ((query.cursorCreatedAt === undefined) !== (query.cursorId === undefined)) {
              throw new Error("invalid_cursor");
            }
            return query;
          })
          .Encode((query) => query),
        response: responses(
          t.Object({
            items: t.Array(ItemDtoSchema),
            nextCursor: nullable(ItemCursorSchema),
          }),
        ),
        detail: detail("遺失物を一覧取得", "filterと複合cursorを使い遺失物を新しい順に返す。", [
          "遺失物",
        ]),
      },
    )
    .post(
      "/api/items",
      async ({ body, set }) => {
        const c = await ctx();
        const b = body;
        const keys = b.image_keys ?? [];
        // 画像なしの登録は現場での照合に使えないため必須化。
        if (keys.length === 0) {
          set.status = 400;
          return { error: "image_required" };
        }
        const storage_location = b.storage_location?.trim() ?? "";
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
          found_x: b.found_x ?? null,
          found_y: b.found_y ?? null,
          image_keys: keys,
          ai_description: b.ai_description ?? "",
          tags: b.tags ?? [],
          notes: b.notes ?? "",
        };
        // 管理番号は設定の採番ルールに従って自動付与（現場・紙台帳での照合用）
        const display_id = b.display_id || (await nextDisplayId(c.store));

        // 画像はあるが特徴文が未指定 → AI解析（vision＋埋め込み＋自動照合）は
        // 現場を待たせないようレスポンスの後ろでバックグラウンド実行する。
        // 一致が見つかった場合は既存の通知の仕組みで届く（この時点の応答には含まれない）。
        if (keys.length > 0 && !draft.ai_description) {
          const item = await c.store.createItem({
            ...draft,
            display_id,
            ai_status: "pending",
          });
          waitUntil(runBackgroundAnalysis(c, item));
          return { item: toItemDto(item), matches: [], topScore: 0 };
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
        const outcome =
          item.status === "stored" && embedding.length
            ? await matchNewItem(c.store, item, c.cfg.matchThreshold)
            : { matches: [], topScore: 0 };
        return {
          item: toItemDto(item),
          matches: outcome.matches,
          topScore: outcome.topScore,
        };
      },
      {
        body: ItemWriteSchema,
        response: responses(
          t.Object({
            item: ItemDtoSchema,
            matches: t.Array(MatchDtoSchema),
            topScore: t.Number(),
          }),
        ),
        detail: detail("遺失物を登録", "画像と保管場所を必須として遺失物を登録し照合を開始する。", [
          "遺失物",
        ]),
      },
    )
    .get(
      "/api/items/:id",
      async ({ params, set }) => {
        const c = await ctx();
        const item = await c.store.getItem(params.id);
        if (!item) {
          set.status = 404;
          return { error: "not found" };
        }
        const matches = (await c.store.listMatches()).filter((m) => m.item_id === params.id);
        return { item: toItemDto(item), matches };
      },
      {
        params: t.Object({ id: t.String({ minLength: 1 }) }),
        response: responses(t.Object({ item: ItemDtoSchema, matches: t.Array(MatchDtoSchema) })),
        detail: detail("遺失物を取得", "遺失物と関連する照合候補を返す。", ["遺失物"]),
      },
    )
    .patch(
      "/api/items/:id",
      async ({ params, body, set }) => {
        const c = await ctx();
        const existing = await c.store.getItem(params.id);
        if (!existing) {
          set.status = 404;
          return { error: "not found" };
        }
        const patch = { ...body };
        if (Object.hasOwn(patch, "storage_location")) {
          patch.storage_location = patch.storage_location?.trim() ?? "";
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
        const updated = await c.store.updateItem(params.id, patch, {
          syncVector: false,
        });
        runAfterSave(refreshItemVector(c, params.id, touchesFeatures), "item", params.id);
        return { item: updated ? toItemDto(updated) : null };
      },
      {
        params: t.Object({ id: t.String({ minLength: 1 }) }),
        body: ItemWriteSchema,
        response: responses(t.Object({ item: nullable(ItemDtoSchema) })),
        detail: detail("遺失物を更新", "指定項目を更新し必要なら特徴ベクトルを再生成する。", [
          "遺失物",
        ]),
      },
    )
    .delete(
      "/api/items/:id",
      async ({ params }) => {
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
                error:
                  result.reason instanceof Error ? result.reason.message : String(result.reason),
              }),
            );
          });
        }
        return { deleted: deletedItem !== null };
      },
      {
        params: t.Object({ id: t.String({ minLength: 1 }) }),
        response: responses(t.Object({ deleted: t.Boolean() })),
        detail: detail("遺失物を削除", "遺失物を削除し関連画像の後処理を行う。", ["遺失物"]),
      },
    )

    // ---- search (vector + filters) ----
    .post(
      "/api/search",
      async ({ body }) => {
        const c = await ctx();
        const filters: SearchFilters = { ...body, limit: body.limit ?? 50 };
        if (!filters.q) {
          // クエリ無しならフィルタのみの一覧
          const page = await c.store.listItems(filters, {
            limit: filters.limit ?? 50,
          });
          return {
            items: page.items.map((i) => toItemDto({ ...i, score: null })),
          };
        }
        const embedding = await safeEmbed(c.ai, filters.q);
        if (!embedding.length) {
          // AI障害時は特徴文検索を諦め、フィルタだけの一覧にフォールバック
          // （検索自体を丸ごとエラーにしない）。degraded を立てて呼び出し側に
          // 「ベクトル検索はできていない」ことを伝える（何も伝えないと検索してるのに
          // スコアが出ず、壊れているようにしか見えない）。
          const page = await c.store.listItems(filters, {
            limit: filters.limit ?? 50,
          });
          return {
            items: page.items.map((i) => toItemDto({ ...i, score: null })),
            degraded: true,
          };
        }
        const items = await c.store.searchItems(embedding, filters);
        return { items: items.map(toItemDto) };
      },
      {
        body: t.Object({
          ...SearchFiltersSchema.properties,
          limit: t.Optional(t.Integer({ minimum: 1, maximum: 200 })),
        }),
        response: responses(
          t.Object({
            items: t.Array(
              t.Object({
                ...ItemDtoSchema.properties,
                score: t.Optional(nullable(t.Number())),
              }),
            ),
            degraded: t.Optional(t.Boolean()),
          }),
        ),
        detail: detail("遺失物を特徴検索", "自然文のベクトル検索と属性filterを組み合わせて返す。", [
          "検索",
        ]),
      },
    )

    // ---- ページ単位の全件再照合（管理画面の手動トリガー） ----
    // 管理画面がカーソルを引き継ぎ、100件ずつ終端まで順番に呼び出す。
    .post(
      "/api/rematch",
      async ({ body }) => {
        const { cursor, runId } = body;
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
      },
      {
        body: t.Object({
          cursor: t.Optional(
            t.Object(
              {
                createdAt: t.String({ format: "date-time" }),
                id: t.String({ minLength: 1 }),
              },
              { error: "invalid_cursor" },
            ),
          ),
          runId: t.Optional(t.String({ format: "uuid", error: "invalid_run_id" })),
        }),
        response: responses(
          t.Object({
            itemsChecked: t.Integer(),
            matchesFound: t.Integer(),
            failed: t.Integer(),
            nextCursor: nullable(ItemCursorSchema),
            done: t.Boolean(),
          }),
        ),
        detail: detail("遺失物をページ単位で再照合", "複合cursorを引き継ぎ全件再照合を進める。", [
          "照合",
        ]),
      },
    )
    .post(
      "/api/rematch/finish",
      async ({ body }) => {
        const runId = body.runId;
        const c = await ctx();
        // 終了通知が失われてもTTLで回収できるよう、削除は補助的に行う。
        await c.store.setSetting(rematchCacheKey(runId), "");
        return { ok: true };
      },
      {
        body: t.Object({
          runId: t.String({ format: "uuid", error: "invalid_run_id" }),
        }),
        response: responses(t.Object({ ok: t.Boolean() })),
        detail: detail("再照合を完了", "再試行用のページ結果キャッシュを解放する。", ["照合"]),
      },
    )

    // ---- inquiries ----
    .get(
      "/api/inquiries",
      async ({ query }) => {
        const c = await ctx();
        const inquiries = await c.store.listInquiries(query.status);
        // ?withMatches=1 で照合候補（＋物品の画像）を同梱。
        // 問い合わせ一覧から候補を写真付きで確認できるようにするため。
        if (query.withMatches !== "1") {
          return { inquiries: inquiries.map(toInquiryDto) };
        }
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
              ...toInquiryDto(inq),
              matches: await Promise.all(
                mine.map(async (m) => {
                  const item = await getItem(m.item_id);
                  return { ...m, item: item ? toItemDto(item) : null };
                }),
              ),
            };
          }),
        );
        return { inquiries: enriched };
      },
      {
        query: t.Object({
          status: t.Optional(InquiryStatusSchema),
          withMatches: t.Optional(t.String()),
        }),
        response: responses(
          t.Object({
            inquiries: t.Array(
              t.Object({
                ...InquiryDtoSchema.properties,
                matches: t.Optional(
                  t.Array(
                    t.Object({
                      ...MatchDtoSchema.properties,
                      item: nullable(ItemDtoSchema),
                    }),
                  ),
                ),
              }),
            ),
          }),
        ),
        detail: detail("問い合わせを一覧取得", "状態で絞り、必要なら照合候補と遺失物を同梱する。", [
          "問い合わせ",
        ]),
      },
    )
    .post(
      "/api/inquiries",
      async ({ body }) => {
        const c = await ctx();
        const b = body;
        const draft = {
          status: "open" as const,
          description: b.description ?? "",
          category: b.category ?? "",
          color: b.color ?? "",
          ai_description: b.description ?? "",
          tags: b.tags ?? [],
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
        return {
          inquiry: toInquiryDto(inquiry),
          matches: outcome.matches,
          topScore: outcome.topScore,
        };
      },
      {
        body: InquiryWriteSchema,
        response: responses(
          t.Object({
            inquiry: InquiryDtoSchema,
            matches: t.Array(MatchDtoSchema),
            topScore: t.Number(),
          }),
        ),
        detail: detail("問い合わせを登録", "聞き取った特徴を保存して遺失物との照合を開始する。", [
          "問い合わせ",
        ]),
      },
    )
    .get(
      "/api/inquiries/:id",
      async ({ params, set }) => {
        const c = await ctx();
        const inquiry = await c.store.getInquiry(params.id);
        if (!inquiry) {
          set.status = 404;
          return { error: "not found" };
        }
        const matches = (await c.store.listMatches()).filter((m) => m.inquiry_id === params.id);
        return { inquiry: toInquiryDto(inquiry), matches };
      },
      {
        params: t.Object({ id: t.String({ minLength: 1 }) }),
        response: responses(
          t.Object({
            inquiry: InquiryDtoSchema,
            matches: t.Array(MatchDtoSchema),
          }),
        ),
        detail: detail("問い合わせを取得", "問い合わせと関連する照合候補を返す。", ["問い合わせ"]),
      },
    )
    .patch(
      "/api/inquiries/:id",
      async ({ params, body, set }) => {
        const c = await ctx();
        const existing = await c.store.getInquiry(params.id);
        if (!existing) {
          set.status = 404;
          return { error: "not found" };
        }
        const patch = { ...body };
        // categoryは埋め込み本文にも含まれるため、同値の再試行を含めて再埋め込みする。
        const touches = touchesAnyField(patch, [
          "category",
          "color",
          "description",
          "tags",
          "notes",
        ]);
        const updated = await c.store.updateInquiry(params.id, patch, {
          syncVector: false,
        });
        runAfterSave(refreshInquiryVector(c, params.id, touches), "inquiry", params.id);
        return { inquiry: updated ? toInquiryDto(updated) : null };
      },
      {
        params: t.Object({ id: t.String({ minLength: 1 }) }),
        body: InquiryWriteSchema,
        response: responses(t.Object({ inquiry: nullable(InquiryDtoSchema) })),
        detail: detail("問い合わせを更新", "指定項目を更新し必要なら特徴ベクトルを再生成する。", [
          "問い合わせ",
        ]),
      },
    )
    .delete(
      "/api/inquiries/:id",
      async ({ params }) => {
        const c = await ctx();
        return { deleted: await c.store.deleteInquiry(params.id) };
      },
      {
        params: t.Object({ id: t.String({ minLength: 1 }) }),
        response: responses(t.Object({ deleted: t.Boolean() })),
        detail: detail("問い合わせを削除", "問い合わせと関連する照合情報を削除する。", [
          "問い合わせ",
        ]),
      },
    )

    // ---- matches ----
    .get(
      "/api/matches",
      async ({ query }) => {
        const c = await ctx();
        const matches = await c.store.listMatches(query.status);
        // 参照物品・問い合わせの要約を同梱（画面で扱いやすく）
        const enriched = await Promise.all(
          matches.map(async (m) => {
            const [item, inquiry] = await Promise.all([
              c.store.getItem(m.item_id),
              c.store.getInquiry(m.inquiry_id),
            ]);
            return {
              ...m,
              item: item ? toItemDto(item) : null,
              inquiry: inquiry ? toInquiryDto(inquiry) : null,
            };
          }),
        );
        return { matches: enriched };
      },
      {
        query: t.Object({ status: t.Optional(MatchStatusSchema) }),
        response: responses(
          t.Object({
            matches: t.Array(
              t.Object({
                ...MatchDtoSchema.properties,
                item: nullable(ItemDtoSchema),
                inquiry: nullable(InquiryDtoSchema),
              }),
            ),
          }),
        ),
        detail: detail("照合候補を一覧取得", "状態で絞り、遺失物と問い合わせの要約を同梱する。", [
          "照合",
        ]),
      },
    )
    .patch(
      "/api/matches/:id",
      async ({ params, body, set }) => {
        const c = await ctx();
        const result = await c.store.decideMatch(params.id, body.status);
        if (!result.ok && result.reason === "not_found") {
          set.status = 404;
          return { error: "not found" };
        }
        if (!result.ok) {
          set.status = 409;
          return { error: "match_confirmation_conflict" };
        }
        return { match: result.match, inquiry: toInquiryDto(result.inquiry) };
      },
      {
        params: t.Object({ id: t.String({ minLength: 1 }) }),
        body: t.Object({
          status: t.Union([t.Literal("confirmed"), t.Literal("rejected")], {
            error: "invalid_match_status",
          }),
        }),
        response: responses(t.Object({ match: MatchDtoSchema, inquiry: InquiryDtoSchema })),
        detail: detail("照合候補を判定", "候補を一致または不一致として原子的に確定する。", [
          "照合",
        ]),
      },
    )

    // ---- notifications ----
    .get(
      "/api/notifications",
      async ({ query }) => {
        const c = await ctx();
        return {
          notifications: await c.store.listNotifications(query.unread === "1"),
        };
      },
      {
        query: t.Object({
          unread: t.Optional(t.Union([t.Literal("0"), t.Literal("1")])),
        }),
        response: responses(t.Object({ notifications: t.Array(NotificationDtoSchema) })),
        detail: detail("通知を一覧取得", "未読だけの絞り込みを含め通知を返す。", ["通知"]),
      },
    )
    .get(
      "/api/notifications/unread-count",
      async () => {
        const c = await ctx();
        return { count: await c.store.unreadCount() };
      },
      {
        response: responses(t.Object({ count: t.Integer({ minimum: 0 }) })),
        detail: detail("未読通知数を取得", "未読通知の件数を返す。", ["通知"]),
      },
    )
    .post(
      "/api/notifications/:id/read",
      async ({ params }) => {
        const c = await ctx();
        return { ok: await c.store.markNotificationRead(params.id) };
      },
      {
        params: t.Object({ id: t.String({ minLength: 1 }) }),
        body: t.Optional(t.Object({})),
        response: responses(t.Object({ ok: t.Boolean() })),
        detail: detail("通知を既読化", "指定した通知を既読にする。", ["通知"]),
      },
    )

    // ---- 物品CSV出力 ----
    .get(
      "/api/export/items.csv",
      async ({ query }) => {
        const c = await ctx();
        return new Response(createItemsCsvStream(c.store, query), {
          headers: {
            "content-type": "text/csv; charset=utf-8",
            "content-disposition": 'attachment; filename="items.csv"',
          },
        });
      },
      {
        query: t.Object({
          ...SearchFiltersSchema.properties,
          limit: t.Optional(t.Numeric({ minimum: 1, maximum: 200 })),
        }),
        response: responses(t.Unknown({ description: "UTF-8 BOM付きのstreaming CSV応答" })),
        detail: detail("遺失物をCSV出力", "filterに一致する全遺失物をstreaming CSVで返す。", [
          "遺失物",
        ]),
      },
    );

  return app;
}

export type App = ReturnType<typeof createApp>;
