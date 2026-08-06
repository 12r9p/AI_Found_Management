import { t, type TSchema } from "elysia";

const nullable = <T extends TSchema>(schema: T) => t.Union([schema, t.Null()]);

export const ErrorResponse = t.Object(
  {
    error: t.String({ description: "エラーを識別するコードまたはメッセージ" }),
    applied: t.Optional(
      t.Boolean({ description: "外部同期に失敗しても主データへの変更が適用済みか" }),
    ),
  },
  { description: "APIエラー" },
);

const commonErrors = {
  400: ErrorResponse,
  403: ErrorResponse,
  404: ErrorResponse,
  409: ErrorResponse,
  413: ErrorResponse,
  500: ErrorResponse,
  503: ErrorResponse,
} as const;

function responses<T extends TSchema>(success: T) {
  return { 200: success, ...commonErrors } as const;
}

const detail = (summary: string, description: string, tags: string[]) => ({
  summary,
  description,
  tags,
});

export const ItemStatusSchema = t.Union(
  [t.Literal("stored"), t.Literal("returned"), t.Literal("disposed"), t.Literal("transferred")],
  { description: "遺失物の処理状態" },
);

export const InquiryStatusSchema = t.Union(
  [
    t.Literal("open"),
    t.Literal("matched"),
    t.Literal("contacted"),
    t.Literal("resolved"),
    t.Literal("closed"),
  ],
  { description: "問い合わせの処理状態" },
);

export const MatchStatusSchema = t.Union(
  [t.Literal("pending"), t.Literal("confirmed"), t.Literal("rejected")],
  { description: "照合候補の確認状態" },
);

export const ItemDtoSchema = t.Object(
  {
    id: t.String({ description: "遺失物ID" }),
    display_id: t.String({ description: "現場と紙台帳で使う管理番号" }),
    status: ItemStatusSchema,
    category: t.String({ description: "種別" }),
    color: t.String({ description: "色" }),
    brand: t.String({ description: "ブランド" }),
    storage_location: t.String({ description: "現物の保管場所" }),
    found_location: t.String({ description: "拾得場所の補助ラベル" }),
    found_at: nullable(t.String({ format: "date-time", description: "拾得日時" })),
    map_key: t.String({ description: "地図画像のキー" }),
    found_x: nullable(t.Number({ minimum: 0, maximum: 1, description: "地図上のX座標" })),
    found_y: nullable(t.Number({ minimum: 0, maximum: 1, description: "地図上のY座標" })),
    image_keys: t.Array(t.String(), { description: "画像キー" }),
    ai_description: t.String({ description: "照合に使う特徴文" }),
    tags: t.Array(t.String(), { description: "特徴タグ" }),
    notes: t.String({ description: "自由記述" }),
    ai_status: t.Union([t.Literal("pending"), t.Literal("ready"), t.Literal("error")], {
      description: "画像解析の進捗",
    }),
    created_at: t.String({ format: "date-time", description: "登録日時" }),
    updated_at: t.String({ format: "date-time", description: "更新日時" }),
  },
  { description: "公開API用の遺失物DTO" },
);

export const InquiryDtoSchema = t.Object(
  {
    id: t.String({ description: "問い合わせID" }),
    status: InquiryStatusSchema,
    description: t.String({ description: "聞き取った特徴" }),
    category: t.String({ description: "種別" }),
    color: t.String({ description: "色" }),
    ai_description: t.String({ description: "照合に使う特徴文" }),
    tags: t.Array(t.String(), { description: "特徴タグ" }),
    reference_no: t.String({ description: "紙台帳の受付番号" }),
    notes: t.String({ description: "自由記述" }),
    matched_item_id: nullable(t.String({ description: "確定した遺失物ID" })),
    created_at: t.String({ format: "date-time", description: "登録日時" }),
    updated_at: t.String({ format: "date-time", description: "更新日時" }),
  },
  { description: "公開API用の問い合わせDTO" },
);

export const MatchDtoSchema = t.Object(
  {
    id: t.String({ description: "照合候補ID" }),
    item_id: t.String({ description: "遺失物ID" }),
    inquiry_id: t.String({ description: "問い合わせID" }),
    score: t.Number({ description: "コサイン類似度" }),
    status: MatchStatusSchema,
    direction: t.Union([t.Literal("item_to_inquiry"), t.Literal("inquiry_to_item")], {
      description: "照合を開始した向き",
    }),
    created_at: t.String({ format: "date-time", description: "作成日時" }),
  },
  { description: "照合候補DTO" },
);

export const NotificationDtoSchema = t.Object(
  {
    id: t.String({ description: "通知ID" }),
    type: t.Union([t.Literal("match_found"), t.Literal("system"), t.Literal("error")]),
    title: t.String(),
    body: t.String(),
    ref_item_id: nullable(t.String()),
    ref_inquiry_id: nullable(t.String()),
    ref_match_id: nullable(t.String()),
    read: t.Boolean(),
    created_at: t.String({ format: "date-time" }),
  },
  { description: "通知DTO" },
);

const ItemCursorSchema = t.Object(
  {
    createdAt: t.String({ format: "date-time", description: "カーソル位置の登録日時" }),
    id: t.String({ minLength: 1, description: "同一日時内のカーソル位置を決めるID" }),
  },
  { description: "遺失物一覧の複合カーソル" },
);

const PointSchema = t.Object({
  x: t.Number({ minimum: 0, maximum: 1 }),
  y: t.Number({ minimum: 0, maximum: 1 }),
});

const LocationPresetSchema = t.Object({
  name: t.String({ minLength: 1, maxLength: 40 }),
  points: t.Array(PointSchema, { minItems: 3, maxItems: 50 }),
});

const MetaOptionSchema = t.Object({
  name: t.String({ minLength: 1, maxLength: 40 }),
  group: t.Optional(t.String({ maxLength: 40 })),
  color: t.Optional(t.String({ pattern: "^#[0-9a-fA-F]{3,8}$" })),
});

const IdRuleSchema = t.Object({
  prefix: t.String({ maxLength: 16 }),
  dateFormat: t.Union([
    t.Literal("none"),
    t.Literal("YYYYMMDD"),
    t.Literal("YYMMDD"),
    t.Literal("YYYYMM"),
  ]),
  separator: t.String({ maxLength: 4 }),
  digits: t.Integer({ minimum: 1, maximum: 10 }),
  reset: t.Union([
    t.Literal("never"),
    t.Literal("daily"),
    t.Literal("monthly"),
    t.Literal("yearly"),
  ]),
  start: t.Integer({ minimum: 0 }),
});

const ItemWriteFields = {
  display_id: t.Optional(t.String()),
  status: t.Optional(ItemStatusSchema),
  category: t.Optional(t.String()),
  color: t.Optional(t.String()),
  brand: t.Optional(t.String()),
  storage_location: t.Optional(t.String()),
  found_location: t.Optional(t.String()),
  found_at: t.Optional(nullable(t.String({ format: "date-time" }))),
  map_key: t.Optional(t.String()),
  found_x: t.Optional(nullable(t.Number({ minimum: 0, maximum: 1 }))),
  found_y: t.Optional(nullable(t.Number({ minimum: 0, maximum: 1 }))),
  image_keys: t.Optional(t.Array(t.String(), { maxItems: 2 })),
  ai_description: t.Optional(t.String()),
  tags: t.Optional(t.Array(t.String())),
  notes: t.Optional(t.String()),
  ai_status: t.Optional(t.Union([t.Literal("pending"), t.Literal("ready"), t.Literal("error")])),
};

const InquiryWriteFields = {
  status: t.Optional(InquiryStatusSchema),
  description: t.Optional(t.String()),
  category: t.Optional(t.String()),
  color: t.Optional(t.String()),
  ai_description: t.Optional(t.String()),
  tags: t.Optional(t.Array(t.String())),
  reference_no: t.Optional(t.String()),
  notes: t.Optional(t.String()),
  matched_item_id: t.Optional(nullable(t.String())),
};

const SearchFilterFields = {
  q: t.Optional(t.String()),
  category: t.Optional(t.String()),
  color: t.Optional(t.String()),
  status: t.Optional(ItemStatusSchema),
  location: t.Optional(t.String()),
  from: t.Optional(t.String()),
  to: t.Optional(t.String()),
};

const ItemListQuerySchema = t.Object({
  ...SearchFilterFields,
  limit: t.Optional(t.String()),
  cursorCreatedAt: t.Optional(t.String()),
  cursorId: t.Optional(t.String()),
});

const SearchBodySchema = t.Object({
  ...SearchFilterFields,
  limit: t.Optional(t.Integer({ minimum: 1, maximum: 200 })),
});

const IdParamsSchema = t.Object({ id: t.String({ minLength: 1 }) });
const KeyParamsSchema = t.Object({ key: t.String({ minLength: 1 }) });
const EmptyBodySchema = t.Object({});

const ItemPageSchema = t.Object({
  items: t.Array(ItemDtoSchema),
  nextCursor: nullable(ItemCursorSchema),
});

const ItemWithScoreSchema = t.Object({
  ...ItemDtoSchema.properties,
  score: t.Optional(nullable(t.Number())),
});

const MatchWithItemSchema = t.Object({
  ...MatchDtoSchema.properties,
  item: nullable(ItemDtoSchema),
});

const InquiryWithMatchesSchema = t.Object({
  ...InquiryDtoSchema.properties,
  matches: t.Optional(t.Array(MatchWithItemSchema)),
});

const EnrichedMatchSchema = t.Object({
  ...MatchDtoSchema.properties,
  item: nullable(ItemDtoSchema),
  inquiry: nullable(InquiryDtoSchema),
});

const ItemMutationResponseSchema = t.Object({
  item: ItemDtoSchema,
  matches: t.Array(MatchDtoSchema),
  topScore: t.Number(),
});

const InquiryMutationResponseSchema = t.Object({
  inquiry: InquiryDtoSchema,
  matches: t.Array(MatchDtoSchema),
  topScore: t.Number(),
});

export const routeContracts = {
  root: {
    response: responses(t.Object({ name: t.String(), ok: t.Boolean() })),
    detail: detail("API情報を取得", "APIの識別情報と稼働状態を返す。", ["システム"]),
  },
  health: {
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
  getMeta: {
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
  putMeta: {
    params: t.Object({ kind: t.String({ description: "categoriesまたはcolors" }) }),
    body: t.Object({ values: t.Array(MetaOptionSchema, { minItems: 1, maxItems: 200 }) }),
    response: responses(t.Object({ values: t.Array(MetaOptionSchema) })),
    detail: detail("選択肢を更新", "種別または色の選択肢を並び順込みで保存する。", ["設定"]),
  },
  getLocationPresets: {
    response: responses(t.Object({ presets: t.Array(LocationPresetSchema) })),
    detail: detail("拾得場所プリセットを取得", "地図上の多角形と名称の組を返す。", ["設定"]),
  },
  putLocationPresets: {
    body: t.Object({ presets: t.Array(LocationPresetSchema, { maxItems: 100 }) }),
    response: responses(t.Object({ presets: t.Array(LocationPresetSchema) })),
    detail: detail("拾得場所プリセットを更新", "地図上の多角形と名称の組を保存する。", ["設定"]),
  },
  getIdRule: {
    response: responses(t.Object({ rule: IdRuleSchema, preview: t.String() })),
    detail: detail("採番ルールを取得", "管理番号の採番ルールとプレビューを返す。", ["設定"]),
  },
  putIdRule: {
    body: t.Object({ rule: IdRuleSchema }),
    response: responses(t.Object({ rule: IdRuleSchema, preview: t.String() })),
    detail: detail("採番ルールを更新", "管理番号の採番ルールを正規化して保存する。", ["設定"]),
  },
  uploadImages: {
    body: t.Object({ image0: t.Optional(t.File()), image1: t.Optional(t.File()) }),
    response: responses(t.Object({ keys: t.Array(t.String(), { maxItems: 2 }) })),
    detail: detail("遺失物画像をアップロード", "最大2枚の画像を保存し画像キーを返す。", ["画像"]),
  },
  getImage: {
    params: KeyParamsSchema,
    query: t.Object({
      variant: t.Optional(
        t.Union([t.Literal("thumb"), t.Literal("preview"), t.Literal("original")]),
      ),
    }),
    response: responses(t.Unknown({ description: "画像Workerが返す画像バイナリ" })),
    detail: detail("画像を取得", "認証後に画像Workerへ転送し、指定variantの画像を返す。", ["画像"]),
  },
  getMap: {
    response: responses(t.Object({ key: t.String() })),
    detail: detail("地図画像を取得", "現在有効な地図画像キーを返す。", ["地図"]),
  },
  uploadMap: {
    body: t.Object({ map: t.Optional(t.File()) }),
    response: responses(t.Object({ key: t.String() })),
    detail: detail("地図画像を更新", "拾得場所入力に使う地図画像を保存する。", ["地図"]),
  },
  analyze: {
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
  listItems: {
    query: ItemListQuerySchema,
    response: responses(ItemPageSchema),
    detail: detail("遺失物を一覧取得", "filterと複合cursorを使い遺失物を新しい順に返す。", [
      "遺失物",
    ]),
  },
  createItem: {
    body: t.Object(ItemWriteFields),
    response: responses(ItemMutationResponseSchema),
    detail: detail("遺失物を登録", "画像と保管場所を必須として遺失物を登録し照合を開始する。", [
      "遺失物",
    ]),
  },
  getItem: {
    params: IdParamsSchema,
    response: responses(t.Object({ item: ItemDtoSchema, matches: t.Array(MatchDtoSchema) })),
    detail: detail("遺失物を取得", "遺失物と関連する照合候補を返す。", ["遺失物"]),
  },
  updateItem: {
    params: IdParamsSchema,
    body: t.Object(ItemWriteFields),
    response: responses(t.Object({ item: nullable(ItemDtoSchema) })),
    detail: detail("遺失物を更新", "指定項目を更新し必要なら特徴ベクトルを再生成する。", [
      "遺失物",
    ]),
  },
  deleteItem: {
    params: IdParamsSchema,
    response: responses(t.Object({ deleted: t.Boolean() })),
    detail: detail("遺失物を削除", "遺失物を削除し関連画像の後処理を行う。", ["遺失物"]),
  },
  searchItems: {
    body: SearchBodySchema,
    response: responses(
      t.Object({ items: t.Array(ItemWithScoreSchema), degraded: t.Optional(t.Boolean()) }),
    ),
    detail: detail("遺失物を特徴検索", "自然文のベクトル検索と属性filterを組み合わせて返す。", [
      "検索",
    ]),
  },
  rematch: {
    body: t.Object({ cursor: t.Optional(t.Unknown()), runId: t.Optional(t.Unknown()) }),
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
  finishRematch: {
    body: t.Object({ runId: t.Unknown() }),
    response: responses(t.Object({ ok: t.Boolean() })),
    detail: detail("再照合を完了", "再試行用のページ結果キャッシュを解放する。", ["照合"]),
  },
  listInquiries: {
    query: t.Object({ status: t.Optional(t.String()), withMatches: t.Optional(t.String()) }),
    response: responses(t.Object({ inquiries: t.Array(InquiryWithMatchesSchema) })),
    detail: detail("問い合わせを一覧取得", "状態で絞り、必要なら照合候補と遺失物を同梱する。", [
      "問い合わせ",
    ]),
  },
  createInquiry: {
    body: t.Object(InquiryWriteFields),
    response: responses(InquiryMutationResponseSchema),
    detail: detail("問い合わせを登録", "聞き取った特徴を保存して遺失物との照合を開始する。", [
      "問い合わせ",
    ]),
  },
  getInquiry: {
    params: IdParamsSchema,
    response: responses(t.Object({ inquiry: InquiryDtoSchema, matches: t.Array(MatchDtoSchema) })),
    detail: detail("問い合わせを取得", "問い合わせと関連する照合候補を返す。", ["問い合わせ"]),
  },
  updateInquiry: {
    params: IdParamsSchema,
    body: t.Object(InquiryWriteFields),
    response: responses(t.Object({ inquiry: nullable(InquiryDtoSchema) })),
    detail: detail("問い合わせを更新", "指定項目を更新し必要なら特徴ベクトルを再生成する。", [
      "問い合わせ",
    ]),
  },
  deleteInquiry: {
    params: IdParamsSchema,
    response: responses(t.Object({ deleted: t.Boolean() })),
    detail: detail("問い合わせを削除", "問い合わせと関連する照合情報を削除する。", ["問い合わせ"]),
  },
  listMatches: {
    query: t.Object({ status: t.Optional(t.String()) }),
    response: responses(t.Object({ matches: t.Array(EnrichedMatchSchema) })),
    detail: detail("照合候補を一覧取得", "状態で絞り、遺失物と問い合わせの要約を同梱する。", [
      "照合",
    ]),
  },
  decideMatch: {
    params: IdParamsSchema,
    body: t.Object({ status: t.Optional(t.String()) }),
    response: responses(t.Object({ match: MatchDtoSchema, inquiry: InquiryDtoSchema })),
    detail: detail("照合候補を判定", "候補を一致または不一致として原子的に確定する。", ["照合"]),
  },
  listNotifications: {
    query: t.Object({ unread: t.Optional(t.String()) }),
    response: responses(t.Object({ notifications: t.Array(NotificationDtoSchema) })),
    detail: detail("通知を一覧取得", "未読だけの絞り込みを含め通知を返す。", ["通知"]),
  },
  unreadCount: {
    response: responses(t.Object({ count: t.Integer({ minimum: 0 }) })),
    detail: detail("未読通知数を取得", "未読通知の件数を返す。", ["通知"]),
  },
  markNotificationRead: {
    params: IdParamsSchema,
    body: t.Optional(EmptyBodySchema),
    response: responses(t.Object({ ok: t.Boolean() })),
    detail: detail("通知を既読化", "指定した通知を既読にする。", ["通知"]),
  },
  exportItemsCsv: {
    query: t.Object({
      ...SearchFilterFields,
      limit: t.Optional(t.String()),
    }),
    response: responses(t.Unknown({ description: "UTF-8 BOM付きのstreaming CSV応答" })),
    detail: detail("遺失物をCSV出力", "filterに一致する全遺失物をstreaming CSVで返す。", [
      "遺失物",
    ]),
  },
} as const;
