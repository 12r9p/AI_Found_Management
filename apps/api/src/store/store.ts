import type {
  Item,
  Inquiry,
  Match,
  Notification,
  NewItem,
  NewInquiry,
  SearchFilters,
} from "../types.ts";
import type { ItemListOptions, ItemPage } from "./item-pagination.ts";

export * from "./item-pagination.ts";

export interface ScoredItem extends Item {
  score: number;
}
export interface ScoredInquiry extends Inquiry {
  score: number;
}

/** 突き合わせヒット1件分。match作成・関連通知・（あれば）問い合わせの状態更新をまとめて渡す。
 * ref_match_id は作成される match の id を実装側が自動で埋めるため呼び出し側は指定しない。 */
export interface MatchBulkEntry {
  match: Omit<Match, "id" | "created_at">;
  notification: Omit<Notification, "id" | "created_at" | "read" | "ref_match_id">;
  inquiryStatusUpdate?: { id: string; status: Inquiry["status"] };
}

export type MatchDecision = Exclude<Match["status"], "pending">;

export type MatchDecisionResult =
  | { ok: true; match: Match; inquiry: Inquiry }
  | { ok: false; reason: "not_found" | "confirmation_conflict" };

export class VectorMetadataSyncError extends Error {
  readonly code = "vector_metadata_sync_failed" as const;
  readonly applied = true as const;

  constructor(
    readonly entity: "item" | "inquiry",
    readonly entityId: string,
    readonly attempts: number,
    cause: unknown,
  ) {
    super(`Vectorize metadata synchronization failed for ${entity} ${entityId}`);
    this.name = "VectorMetadataSyncError";
    this.cause = cause;
  }
}

/**
 * データアクセス抽象。現場で「DB をほぼ直接触る」編集要件に応えるため、
 * update は任意フィールドの部分更新を許す。
 */
export interface Store {
  readonly kind: "memory" | "d1";
  init(): Promise<void>;

  // --- items ---
  createItem(data: NewItem): Promise<Item>;
  getItem(id: string): Promise<Item | null>;
  listItems(filters: SearchFilters, options?: ItemListOptions): Promise<ItemPage>;
  updateItem(id: string, patch: Partial<Item>): Promise<Item | null>;
  deleteItem(id: string): Promise<boolean>;
  searchItems(embedding: number[], filters: SearchFilters): Promise<ScoredItem[]>;

  // --- inquiries ---
  createInquiry(data: NewInquiry): Promise<Inquiry>;
  getInquiry(id: string): Promise<Inquiry | null>;
  listInquiries(status?: string): Promise<Inquiry[]>;
  updateInquiry(id: string, patch: Partial<Inquiry>): Promise<Inquiry | null>;
  deleteInquiry(id: string): Promise<boolean>;
  /** filters.status を渡すと（Vectorizeのメタデータインデックス作成済みなら）その状態の
   * 問い合わせだけをクエリ時点で絞り込む。未対応環境では黙って全件から絞り込む。 */
  searchInquiries(
    embedding: number[],
    limit: number,
    filters?: { status?: string[] },
  ): Promise<ScoredInquiry[]>;

  // --- matches ---
  createMatch(m: Omit<Match, "id" | "created_at">): Promise<Match>;
  listMatches(status?: string): Promise<Match[]>;
  getMatch(id: string): Promise<Match | null>;
  /**
   * 照合判断と、その問い合わせの状態・確定物品を1つの原子的な操作として更新する。
   */
  decideMatch(id: string, decision: MatchDecision): Promise<MatchDecisionResult>;
  findMatch(itemId: string, inquiryId: string): Promise<Match | null>;
  /**
   * 複数の突き合わせヒットを一括で確定させる（match作成＋通知作成＋問い合わせ状態更新）。
   * D1実装は db.batch() で1往復にまとめ、ヒット件数分の直列ラウンドトリップを避ける。
   */
  createMatchesBulk(entries: MatchBulkEntry[]): Promise<Match[]>;

  // --- notifications ---
  createNotification(n: Omit<Notification, "id" | "created_at" | "read">): Promise<Notification>;
  listNotifications(unreadOnly?: boolean): Promise<Notification[]>;
  markNotificationRead(id: string): Promise<boolean>;
  unreadCount(): Promise<number>;

  // --- settings (key-value, 地図キーなどアプリ設定) ---
  getSetting(key: string): Promise<string | null>;
  setSetting(key: string, value: string): Promise<void>;

  /**
   * name+period に紐づく連番をアトミックに払い出す（管理番号の採番などに使用）。
   * period が前回と変わっていたら start から採番し直す。同時に複数箇所から
   * 呼ばれても重複しないことを保証する（read-modify-write ではなく単一操作）。
   */
  nextCounter(name: string, period: string, start: number): Promise<number>;
}

export function nowIso(): string {
  return new Date().toISOString();
}
export function newId(): string {
  return crypto.randomUUID();
}
