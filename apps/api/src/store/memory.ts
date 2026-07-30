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
  nowIso,
  newId,
} from "./store.ts";

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
    item.created_at = nowIso();
    item.updated_at = item.created_at;
    this.items.unshift(item);
    this.persist();
    return item;
  }
  async getItem(id: string): Promise<Item | null> {
    return this.items.find((i) => i.id === id) ?? null;
  }
  async listItems(filters: SearchFilters): Promise<Item[]> {
    return applyItemFilters(this.items, filters).slice(0, filters.limit ?? 500);
  }
  async updateItem(id: string, patch: Partial<Item>): Promise<Item | null> {
    const it = this.items.find((i) => i.id === id);
    if (!it) return null;
    Object.assign(it, clean(patch), { id, updated_at: nowIso() });
    this.persist();
    return it;
  }
  async deleteItem(id: string): Promise<boolean> {
    const n = this.items.length;
    this.items = this.items.filter((i) => i.id !== id);
    this.persist();
    return this.items.length < n;
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
    const n = this.inquiries.length;
    this.inquiries = this.inquiries.filter((i) => i.id !== id);
    this.persist();
    return this.inquiries.length < n;
  }
  async listOpenInquiries(): Promise<Inquiry[]> {
    return this.inquiries.filter((i) => i.status === "open" || i.status === "matched");
  }
  async searchInquiries(embedding: number[], limit: number): Promise<ScoredInquiry[]> {
    const scored = this.inquiries.map((inq) => ({
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
  async updateMatch(id: string, patch: Partial<Match>): Promise<Match | null> {
    const m = this.matches.find((x) => x.id === id);
    if (!m) return null;
    Object.assign(m, patch, { id });
    this.persist();
    return m;
  }
  async findMatch(itemId: string, inquiryId: string): Promise<Match | null> {
    return (
      this.matches.find((m) => m.item_id === itemId && m.inquiry_id === inquiryId) ?? null
    );
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
    storage_location: "",
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
