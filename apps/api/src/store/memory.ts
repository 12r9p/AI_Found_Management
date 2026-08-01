import type {
  Item,
  Inquiry,
  Match,
  Notification,
  NewItem,
  NewInquiry,
  SearchFilters,
} from "../types.ts";
import { cosineSimilarity } from "../lib/vector.ts";
import {
  type Store,
  type ScoredItem,
  type ScoredInquiry,
  type MatchBulkEntry,
  type MatchDecision,
  type MatchDecisionResult,
  nowIso,
  newId,
} from "./store.ts";
import { DuplicateDisplayIdError } from "./errors.ts";
import {
  compareItemsNewestFirst,
  isItemAfterCursor,
  normalizeItemPageLimit,
  parseItemCursor,
  toItemPage,
  type ItemListOptions,
  type ItemPage,
} from "./item-pagination.ts";

/**
 * インメモリ実装。D1/Vectorize バインディング未設定時の既定。
 * 外部依存ゼロでフル機能（ベクトル検索・突き合わせ）を再現する。
 * 注: プロセス揮発。永続化には D1VectorizeStore を使うこと。
 */
export class MemoryStore implements Store {
  readonly kind = "memory" as const;
  private items: Item[] = [];
  private inquiries: Inquiry[] = [];
  private matches: Match[] = [];
  private notifications: Notification[] = [];
  private settings: Map<string, string> = new Map();
  private counters: Map<string, { period: string; next: number }> = new Map();

  // --- ローカル開発用の簡易永続化 ---
  // ファイルシステムが使える環境（Bun）では JSON に保存し、
  // API を再起動しても登録内容が消えないようにする。
  // （Workers ではファイルAPIが無いので自動的に無効＝純粋なメモリ動作）
  private file: string | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  async init(): Promise<void> {
    if (!(globalThis as any).process?.versions) return; // Workers 等では永続化しない
    try {
      const { mkdir, readFile } = await import("node:fs/promises");
      const dir = `${decodeURIComponent(new URL("../../", import.meta.url).pathname).replace(/\/$/, "")}/.data`;
      await mkdir(dir, { recursive: true });
      this.file = `${dir}/store.json`;
      const raw = await readFile(this.file, "utf8").catch(() => null);
      if (raw) {
        const d = JSON.parse(raw);
        this.items = d.items ?? [];
        this.inquiries = d.inquiries ?? [];
        this.matches = d.matches ?? [];
        this.notifications = d.notifications ?? [];
        this.settings = new Map(Object.entries(d.settings ?? {}));
      }
    } catch {
      this.file = null; // 使えなければメモリのみで動作（機能は落とさない）
    }
  }

  /** 書き込みは頻繁なのでまとめて保存する。 */
  private persist(): void {
    if (!this.file) return;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(async () => {
      try {
        const { writeFile } = await import("node:fs/promises");
        await writeFile(
          this.file!,
          JSON.stringify({
            items: this.items,
            inquiries: this.inquiries,
            matches: this.matches,
            notifications: this.notifications,
            settings: Object.fromEntries(this.settings),
          }),
        );
      } catch {
        /* 保存に失敗してもアプリは動かし続ける */
      }
    }, 300);
  }

  async getSetting(key: string): Promise<string | null> {
    return this.settings.get(key) ?? null;
  }
  async setSetting(key: string, value: string): Promise<void> {
    this.settings.set(key, value);
    this.persist();
  }

  async nextCounter(name: string, period: string, start: number): Promise<number> {
    // 単一プロセス・await を挟まない同期操作なので競合しない。
    const cur = this.counters.get(name);
    const issued = cur && cur.period === period ? cur.next : start;
    this.counters.set(name, { period, next: issued + 1 });
    return issued;
  }

  // --- items ---
  async createItem(data: NewItem): Promise<Item> {
    const item = { ...blankItem(), ...clean(data), id: newId() } as Item;
    this.assertDisplayIdAvailable(item.display_id);
    item.created_at = nowIso();
    item.updated_at = item.created_at;
    this.items.unshift(item);
    this.persist();
    return item;
  }
  async getItem(id: string): Promise<Item | null> {
    return this.items.find((i) => i.id === id) ?? null;
  }
  async listItems(filters: SearchFilters, options: ItemListOptions = {}): Promise<ItemPage> {
    const limit = normalizeItemPageLimit(options.limit);
    const cursor = options.cursor ? parseItemCursor(options.cursor) : null;
    const items = applyItemFilters(this.items, filters).sort(compareItemsNewestFirst);
    const remaining = cursor ? items.filter((item) => isItemAfterCursor(item, cursor)) : items;
    return toItemPage(remaining.slice(0, limit + 1), limit);
  }
  async updateItem(id: string, patch: Partial<Item>): Promise<Item | null> {
    const it = this.items.find((i) => i.id === id);
    if (!it) return null;
    if (patch.display_id !== undefined) {
      this.assertDisplayIdAvailable(patch.display_id, id);
    }
    Object.assign(it, clean(patch), { id, updated_at: nowIso() });
    this.persist();
    return it;
  }
  async deleteItem(id: string): Promise<boolean> {
    if (!this.items.some((item) => item.id === id)) return false;
    const removedMatchIds = new Set(
      this.matches.filter((match) => match.item_id === id).map((match) => match.id),
    );
    const affectedInquiryIds = new Set(
      this.matches.filter((match) => match.item_id === id).map((match) => match.inquiry_id),
    );
    for (const inquiry of this.inquiries) {
      if (inquiry.matched_item_id === id) affectedInquiryIds.add(inquiry.id);
    }

    this.items = this.items.filter((item) => item.id !== id);
    this.matches = this.matches.filter((match) => match.item_id !== id);
    for (const notification of this.notifications) {
      if (notification.ref_item_id === id) notification.ref_item_id = null;
      if (notification.ref_match_id && removedMatchIds.has(notification.ref_match_id)) {
        notification.ref_match_id = null;
      }
    }
    const updatedAt = nowIso();
    for (const inquiryId of affectedInquiryIds) {
      const inquiry = this.inquiries.find((candidate) => candidate.id === inquiryId);
      if (inquiry) this.recomputeInquiryState(inquiry, updatedAt);
    }
    this.persist();
    return true;
  }

  /** 空でない管理番号はSQLite既定と同じ完全一致で比較する。 */
  private assertDisplayIdAvailable(displayId: string, currentId?: string): void {
    if (
      displayId !== "" &&
      this.items.some((item) => item.id !== currentId && item.display_id === displayId)
    ) {
      throw new DuplicateDisplayIdError();
    }
  }
  async searchItems(embedding: number[], filters: SearchFilters): Promise<ScoredItem[]> {
    const base = applyItemFilters(this.items, filters);
    const scored = base.map((it) => ({
      ...it,
      score: it.embedding?.length ? cosineSimilarity(embedding, it.embedding) : 0,
    }));
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, filters.limit ?? 50);
  }

  // --- inquiries ---
  async createInquiry(data: NewInquiry): Promise<Inquiry> {
    const inq = { ...blankInquiry(), ...clean(data), id: newId() } as Inquiry;
    inq.created_at = nowIso();
    inq.updated_at = inq.created_at;
    this.inquiries.unshift(inq);
    this.persist();
    return inq;
  }
  async getInquiry(id: string): Promise<Inquiry | null> {
    return this.inquiries.find((i) => i.id === id) ?? null;
  }
  async listInquiries(status?: string): Promise<Inquiry[]> {
    return status ? this.inquiries.filter((i) => i.status === status) : this.inquiries;
  }
  async updateInquiry(id: string, patch: Partial<Inquiry>): Promise<Inquiry | null> {
    const inq = this.inquiries.find((i) => i.id === id);
    if (!inq) return null;
    Object.assign(inq, clean(patch), { id, updated_at: nowIso() });
    this.persist();
    return inq;
  }
  async deleteInquiry(id: string): Promise<boolean> {
    if (!this.inquiries.some((inquiry) => inquiry.id === id)) return false;
    const removedMatchIds = new Set(
      this.matches.filter((match) => match.inquiry_id === id).map((match) => match.id),
    );
    this.inquiries = this.inquiries.filter((inquiry) => inquiry.id !== id);
    this.matches = this.matches.filter((match) => match.inquiry_id !== id);
    for (const notification of this.notifications) {
      if (notification.ref_inquiry_id === id) notification.ref_inquiry_id = null;
      if (notification.ref_match_id && removedMatchIds.has(notification.ref_match_id)) {
        notification.ref_match_id = null;
      }
    }
    this.persist();
    return true;
  }
  async searchInquiries(
    embedding: number[],
    limit: number,
    filters?: { status?: string[] },
  ): Promise<ScoredInquiry[]> {
    const pool = filters?.status?.length
      ? this.inquiries.filter((i) => filters.status!.includes(i.status))
      : this.inquiries;
    const scored = pool.map((inq) => ({
      ...inq,
      score: inq.embedding?.length ? cosineSimilarity(embedding, inq.embedding) : 0,
    }));
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit);
  }

  // --- matches ---
  async createMatch(m: Omit<Match, "id" | "created_at">): Promise<Match> {
    const match: Match = { ...m, id: newId(), created_at: nowIso() };
    this.matches.unshift(match);
    this.persist();
    return match;
  }
  async listMatches(status?: string): Promise<Match[]> {
    return status ? this.matches.filter((m) => m.status === status) : this.matches;
  }
  async getMatch(id: string): Promise<Match | null> {
    return this.matches.find((m) => m.id === id) ?? null;
  }
  async decideMatch(id: string, decision: MatchDecision): Promise<MatchDecisionResult> {
    const match = this.matches.find((candidate) => candidate.id === id);
    if (!match) return { ok: false, reason: "not_found" };

    if (
      decision === "confirmed" &&
      this.matches.some(
        (candidate) =>
          candidate.inquiry_id === match.inquiry_id &&
          candidate.id !== match.id &&
          candidate.status === "confirmed",
      )
    ) {
      return { ok: false, reason: "confirmation_conflict" };
    }

    const inquiry = this.inquiries.find((candidate) => candidate.id === match.inquiry_id);
    if (!inquiry) throw new Error(`照合 ${id} の問い合わせが見つかりません`);

    match.status = decision;
    this.recomputeInquiryState(inquiry, nowIso());
    this.persist();
    return { ok: true, match, inquiry };
  }

  /** 現在残っている照合候補だけを使い、問い合わせの派生状態を再計算する。 */
  private recomputeInquiryState(inquiry: Inquiry, updatedAt: string): void {
    const related = this.matches.filter((candidate) => candidate.inquiry_id === inquiry.id);
    const confirmed = related.find((candidate) => candidate.status === "confirmed");
    if (inquiry.status !== "closed") {
      inquiry.status = confirmed
        ? "resolved"
        : related.some((candidate) => candidate.status === "pending")
          ? "matched"
          : "open";
    }
    inquiry.matched_item_id = confirmed?.item_id ?? null;
    inquiry.updated_at = updatedAt;
  }
  async findMatch(itemId: string, inquiryId: string): Promise<Match | null> {
    return this.matches.find((m) => m.item_id === itemId && m.inquiry_id === inquiryId) ?? null;
  }
  async createMatchesBulk(entries: MatchBulkEntry[]): Promise<Match[]> {
    // 単一プロセスなのでラウンドトリップの問題はないが、D1実装とインターフェースを揃える。
    const out: Match[] = [];
    for (const e of entries) {
      const m = await this.createMatch(e.match);
      out.push(m);
      if (e.inquiryStatusUpdate) {
        await this.updateInquiry(e.inquiryStatusUpdate.id, {
          status: e.inquiryStatusUpdate.status,
        });
      }
      await this.createNotification({ ...e.notification, ref_match_id: m.id });
    }
    return out;
  }

  // --- notifications ---
  async createNotification(
    n: Omit<Notification, "id" | "created_at" | "read">,
  ): Promise<Notification> {
    const notif: Notification = { ...n, id: newId(), read: false, created_at: nowIso() };
    this.notifications.unshift(notif);
    this.persist();
    return notif;
  }
  async listNotifications(unreadOnly = false): Promise<Notification[]> {
    return unreadOnly ? this.notifications.filter((n) => !n.read) : this.notifications;
  }
  async markNotificationRead(id: string): Promise<boolean> {
    const n = this.notifications.find((x) => x.id === id);
    if (!n) return false;
    n.read = true;
    this.persist();
    return true;
  }
  async unreadCount(): Promise<number> {
    return this.notifications.filter((n) => !n.read).length;
  }
}

// --- helpers ---
function blankItem(): Item {
  return {
    id: "",
    display_id: "",
    status: "stored",
    category: "",
    color: "",
    brand: "",
    found_location: "",
    found_at: null,
    map_key: "",
    found_x: null,
    found_y: null,
    image_keys: [],
    ai_description: "",
    tags: [],
    embedding: [],
    notes: "",
    ai_status: "ready",
    created_at: "",
    updated_at: "",
  };
}
function blankInquiry(): Inquiry {
  return {
    id: "",
    status: "open",
    description: "",
    category: "",
    color: "",
    ai_description: "",
    tags: [],
    embedding: [],
    reference_no: "",
    notes: "",
    matched_item_id: null,
    created_at: "",
    updated_at: "",
  };
}

/** undefined を除いた部分オブジェクト。空更新で既存値を潰さない。 */
function clean<T extends object>(o: T): Partial<T> {
  const out: any = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined) out[k] = v;
  return out;
}

export function applyItemFilters(items: Item[], f: SearchFilters): Item[] {
  return items.filter((it) => {
    if (f.category && it.category !== f.category) return false;
    if (f.color && it.color !== f.color) return false;
    if (f.status && it.status !== f.status) return false;
    if (f.location && !it.found_location.includes(f.location)) return false;
    if (f.from && it.found_at && it.found_at < f.from) return false;
    if (f.to && it.found_at && it.found_at > f.to) return false;
    return true;
  });
}
