// ドメイン型定義

export type ItemStatus =
  | "stored" // 保管中
  | "returned" // 返却済み
  | "disposed" // 廃棄
  | "transferred"; // 警察等へ移管

export type InquiryStatus =
  | "open" // 未解決（照合待ち）
  | "matched" // 候補あり
  | "resolved" // 解決
  | "closed"; // 取り下げ

export type MatchStatus =
  | "pending" // 自動照合ヒット・スタッフ確認待ち
  | "confirmed" // スタッフが一致と確認
  | "rejected"; // 一致しないと判断

/** 遺失物（拾得物）。個人情報は保持しない。 */
export interface Item {
  id: string;
  /** 現場・紙台帳で使う管理番号（採番ルールは設定で変更可）。例: FD-20260729-0001 */
  display_id: string;
  status: ItemStatus;
  category: string; // 種別（例: 財布, 傘, スマホ）
  color: string;
  brand: string;
  found_location: string; // 拾得場所（エリア名などの補助ラベル）
  found_at: string | null; // 拾得日時 (ISO)
  map_key: string; // 地図画像の R2 キー（拾得場所ピン用）
  found_x: number | null; // ピンの正規化X座標 (0..1)
  found_y: number | null; // ピンの正規化Y座標 (0..1)
  storage_location: string; // 保管場所（棚番号など）
  image_keys: string[]; // R2 オブジェクトキー（最大2枚想定）
  ai_description: string; // AI が生成した特徴文
  tags: string[]; // AI 抽出タグ
  embedding: number[]; // 特徴ベクトル
  notes: string; // 自由記述
  created_at: string;
  updated_at: string;
}

/** 未解決問い合わせ。個人情報は含めず、探し物の特徴のみ保持。 */
export interface Inquiry {
  id: string;
  status: InquiryStatus;
  description: string; // スタッフが聞き取った特徴（口頭→要約）
  category: string;
  color: string;
  ai_description: string;
  tags: string[];
  embedding: number[];
  reference_no: string; // 紙台帳の受付番号（個人情報ではない）
  notes: string;
  matched_item_id: string | null;
  created_at: string;
  updated_at: string;
}

/** 遺失物 ⇔ 問い合わせ の突き合わせ結果。 */
export interface Match {
  id: string;
  item_id: string;
  inquiry_id: string;
  score: number; // コサイン類似度
  status: MatchStatus;
  direction: "item_to_inquiry" | "inquiry_to_item";
  created_at: string;
}

export interface Notification {
  id: string;
  type: "match_found" | "system";
  title: string;
  body: string;
  ref_item_id: string | null;
  ref_inquiry_id: string | null;
  ref_match_id: string | null;
  read: boolean;
  created_at: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
}

export type NewItem = Partial<Omit<Item, "id" | "created_at" | "updated_at">>;
export type NewInquiry = Partial<Omit<Inquiry, "id" | "created_at" | "updated_at">>;

export interface SearchFilters {
  q?: string; // 自然文クエリ（ベクトル検索）
  category?: string;
  color?: string;
  status?: ItemStatus;
  location?: string; // 拾得場所の部分一致
  from?: string; // 拾得日 下限
  to?: string; // 拾得日 上限
  limit?: number;
}
