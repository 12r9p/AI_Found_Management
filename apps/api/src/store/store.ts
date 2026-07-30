import type {
  Item,
  Inquiry,
  Match,
  Notification,
  NewItem,
  NewInquiry,
  SearchFilters,
} from "../types.ts";

export interface ScoredItem extends Item {
  score: number;
}
export interface ScoredInquiry extends Inquiry {
  score: number;
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
  listItems(filters: SearchFilters): Promise<Item[]>;
  updateItem(id: string, patch: Partial<Item>): Promise<Item | null>;
  deleteItem(id: string): Promise<boolean>;
  searchItems(embedding: number[], filters: SearchFilters): Promise<ScoredItem[]>;

  // --- inquiries ---
  createInquiry(data: NewInquiry): Promise<Inquiry>;
  getInquiry(id: string): Promise<Inquiry | null>;
  listInquiries(status?: string): Promise<Inquiry[]>;
  updateInquiry(id: string, patch: Partial<Inquiry>): Promise<Inquiry | null>;
  deleteInquiry(id: string): Promise<boolean>;
  listOpenInquiries(): Promise<Inquiry[]>;
  searchInquiries(embedding: number[], limit: number): Promise<ScoredInquiry[]>;

  // --- matches ---
  createMatch(m: Omit<Match, "id" | "created_at">): Promise<Match>;
  listMatches(status?: string): Promise<Match[]>;
  getMatch(id: string): Promise<Match | null>;
  updateMatch(id: string, patch: Partial<Match>): Promise<Match | null>;
  findMatch(itemId: string, inquiryId: string): Promise<Match | null>;

  // --- notifications ---
  createNotification(
    n: Omit<Notification, "id" | "created_at" | "read">,
  ): Promise<Notification>;
  listNotifications(unreadOnly?: boolean): Promise<Notification[]>;
  markNotificationRead(id: string): Promise<boolean>;
  unreadCount(): Promise<number>;

  // --- settings (key-value, 地図キーなどアプリ設定) ---
  getSetting(key: string): Promise<string | null>;
  setSetting(key: string, value: string): Promise<void>;
}

export function nowIso(): string {
  return new Date().toISOString();
}
export function newId(): string {
  return crypto.randomUUID();
}
