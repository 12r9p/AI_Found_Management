import { t, type TSchema } from "elysia";

export const nullable = <T extends TSchema>(schema: T) => t.Union([schema, t.Null()]);

export const ErrorResponse = t.Object(
  {
    error: t.String({ description: "エラーを識別するコードまたはメッセージ" }),
    applied: t.Optional(
      t.Boolean({
        description: "外部同期に失敗しても主データへの変更が適用済みか",
      }),
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

export function responses<T extends TSchema>(success: T) {
  return { 200: success, ...commonErrors } as const;
}

export const detail = (summary: string, description: string, tags: string[]) => ({
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

export const ItemCursorSchema = t.Object(
  {
    createdAt: t.String({
      format: "date-time",
      description: "カーソル位置の登録日時",
    }),
    id: t.String({
      minLength: 1,
      description: "同一日時内のカーソル位置を決めるID",
    }),
  },
  { description: "遺失物一覧の複合カーソル" },
);

const PointSchema = t.Object({
  x: t.Number({ minimum: 0, maximum: 1 }),
  y: t.Number({ minimum: 0, maximum: 1 }),
});

export const LocationPresetSchema = t.Object({
  name: t.String({ minLength: 1, maxLength: 40 }),
  points: t.Array(PointSchema, { minItems: 3, maxItems: 50 }),
});

export const MetaOptionSchema = t.Object({
  name: t.String({ minLength: 1, maxLength: 40 }),
  group: t.Optional(t.String({ maxLength: 40 })),
  color: t.Optional(t.String({ pattern: "^#[0-9a-fA-F]{3,8}$" })),
});

export const IdRuleSchema = t.Object({
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

export const ItemWriteSchema = t.Object({
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
});

export const InquiryWriteSchema = t.Object({
  status: t.Optional(InquiryStatusSchema),
  description: t.Optional(t.String()),
  category: t.Optional(t.String()),
  color: t.Optional(t.String()),
  ai_description: t.Optional(t.String()),
  tags: t.Optional(t.Array(t.String())),
  reference_no: t.Optional(t.String()),
  notes: t.Optional(t.String()),
  matched_item_id: t.Optional(nullable(t.String())),
});

export const SearchFiltersSchema = t.Object({
  q: t.Optional(t.String()),
  category: t.Optional(t.String()),
  color: t.Optional(t.String()),
  status: t.Optional(ItemStatusSchema),
  location: t.Optional(t.String()),
  from: t.Optional(t.String()),
  to: t.Optional(t.String()),
});
