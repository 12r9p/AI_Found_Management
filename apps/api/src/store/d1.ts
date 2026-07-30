import type {
  Item,
  Inquiry,
  Match,
  Notification,
  NewItem,
  NewInquiry,
  SearchFilters,
} from "../types.ts";
import {
  type Store,
  type ScoredItem,
  type ScoredInquiry,
  nowIso,
  newId,
} from "./store.ts";
import { applyItemFilters } from "./memory.ts";
import { cosineSimilarity } from "../lib/vector.ts";

/**
 * D1 + Vectorize 実装。D1 = 行データの永続化(source of truth)、
 * Vectorize = 埋め込みベクトルの近似最近傍検索専用(id と vector のみ保持)。
 * items と inquiries で意味空間が異なるため、Vectorize インデックスは2つ束ねる。
 * 埋め込みはクライアントへ返さない(pg 実装と同じ規約)。
 */
export class D1VectorizeStore implements Store {
  readonly kind = "d1" as const;
  constructor(
    private db: D1Database,
    private vectorizeItems: Vectorize,
    private vectorizeInquiries: Vectorize,
  ) {}

  async init(): Promise<void> {
    // スキーマは `wrangler d1 migrations apply` で事前適用済みの前提。ここでは何もしない。
  }

  // --- items ---
  async createItem(d: NewItem): Promise<Item> {
    const id = newId();
    const created_at = nowIso();
    const row = await this.db
      .prepare(
        `INSERT INTO items
          (id, display_id, status, category, color, brand, found_location, found_at, map_key, found_x, found_y,
           storage_location, image_keys, ai_description, tags, notes, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
         RETURNING ${ITEM_COLS}`,
      )
      .bind(
        id,
        d.display_id ?? "",
        d.status ?? "stored",
        d.category ?? "",
        d.color ?? "",
        d.brand ?? "",
        d.found_location ?? "",
        d.found_at ?? null,
        d.map_key ?? "",
        d.found_x ?? null,
        d.found_y ?? null,
        d.storage_location ?? "",
        JSON.stringify(d.image_keys ?? []),
        d.ai_description ?? "",
        JSON.stringify(d.tags ?? []),
        d.notes ?? "",
        created_at,
        created_at,
      )
      .first();
    if (d.embedding && d.embedding.length) {
      await this.vectorizeItems.upsert([{ id, values: d.embedding }]);
    }
    return rowToItem(row);
  }
  async getItem(id: string): Promise<Item | null> {
    const row = await this.db
      .prepare(`SELECT ${ITEM_COLS} FROM items WHERE id=?`)
      .bind(id)
      .first();
    return row ? rowToItem(row) : null;
  }
  async listItems(f: SearchFilters): Promise<Item[]> {
    const { where, params } = buildItemWhere(f);
    const { results } = await this.db
      .prepare(`SELECT ${ITEM_COLS} FROM items ${where} ORDER BY created_at DESC LIMIT ?`)
      .bind(...params, limit(f, 500))
      .all();
    return (results as any[]).map(rowToItem);
  }
  async updateItem(id: string, patch: Partial<Item>): Promise<Item | null> {
    const { set, params } = buildSet(patch, ITEM_FIELDS);
    let row: any;
    if (!set) {
      row = await this.db.prepare(`SELECT ${ITEM_COLS} FROM items WHERE id=?`).bind(id).first();
    } else {
      row = await this.db
        .prepare(
          `UPDATE items SET ${set}, updated_at=? WHERE id=? RETURNING ${ITEM_COLS}`,
        )
        .bind(...params, nowIso(), id)
        .first();
    }
    if (!row) return null;
    if (patch.embedding && patch.embedding.length) {
      await this.vectorizeItems.upsert([{ id, values: patch.embedding }]);
    }
    return rowToItem(row);
  }
  async deleteItem(id: string): Promise<boolean> {
    const row = await this.db
      .prepare(`DELETE FROM items WHERE id=? RETURNING id`)
      .bind(id)
      .first();
    if (!row) return false;
    await this.vectorizeItems.deleteByIds([id]);
    return true;
  }
  async searchItems(embedding: number[], f: SearchFilters): Promise<ScoredItem[]> {
    // Vectorize のスコアは近似(quantization 由来の誤差があり閾値ぎりぎりの判定がぶれうる)。
    // returnValues で候補ベクトルを取得し、JS 側で厳密なコサイン類似度に置き換える。
    const topK = Math.max(1, Math.min(50, (f.limit ?? 50) * 4));
    const res = await this.vectorizeItems.query(embedding, { topK, returnValues: true });
    if (res.matches.length === 0) return [];
    const scoreById = new Map(
      res.matches.map((m) => [m.id, cosineSimilarity(embedding, Array.from(m.values ?? []))]),
    );
    const ids = res.matches.map((m) => m.id);
    const { results } = await this.db
      .prepare(`SELECT ${ITEM_COLS} FROM items WHERE id IN (${ids.map(() => "?").join(",")})`)
      .bind(...ids)
      .all();
    const items = (results as any[]).map(rowToItem);
    const scored = applyItemFilters(items, f)
      .map((it) => ({ ...it, score: scoreById.get(it.id) ?? 0 }))
      .sort((a, b) => b.score - a.score);
    return scored.slice(0, f.limit ?? 50);
  }

  // --- inquiries ---
  async createInquiry(d: NewInquiry): Promise<Inquiry> {
    const id = newId();
    const created_at = nowIso();
    const row = await this.db
      .prepare(
        `INSERT INTO inquiries
          (id, status, description, category, color, ai_description, tags,
           reference_no, notes, matched_item_id, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
         RETURNING ${INQ_COLS}`,
      )
      .bind(
        id,
        d.status ?? "open",
        d.description ?? "",
        d.category ?? "",
        d.color ?? "",
        d.ai_description ?? "",
        JSON.stringify(d.tags ?? []),
        d.reference_no ?? "",
        d.notes ?? "",
        d.matched_item_id ?? null,
        created_at,
        created_at,
      )
      .first();
    if (d.embedding && d.embedding.length) {
      await this.vectorizeInquiries.upsert([{ id, values: d.embedding }]);
    }
    return rowToInquiry(row);
  }
  async getInquiry(id: string): Promise<Inquiry | null> {
    const row = await this.db
      .prepare(`SELECT ${INQ_COLS} FROM inquiries WHERE id=?`)
      .bind(id)
      .first();
    return row ? rowToInquiry(row) : null;
  }
  async listInquiries(status?: string): Promise<Inquiry[]> {
    const { results } = status
      ? await this.db
          .prepare(`SELECT ${INQ_COLS} FROM inquiries WHERE status=? ORDER BY created_at DESC`)
          .bind(status)
          .all()
      : await this.db
          .prepare(`SELECT ${INQ_COLS} FROM inquiries ORDER BY created_at DESC`)
          .all();
    return (results as any[]).map(rowToInquiry);
  }
  async updateInquiry(id: string, patch: Partial<Inquiry>): Promise<Inquiry | null> {
    const { set, params } = buildSet(patch, INQ_FIELDS);
    let row: any;
    if (!set) {
      row = await this.db
        .prepare(`SELECT ${INQ_COLS} FROM inquiries WHERE id=?`)
        .bind(id)
        .first();
    } else {
      row = await this.db
        .prepare(`UPDATE inquiries SET ${set}, updated_at=? WHERE id=? RETURNING ${INQ_COLS}`)
        .bind(...params, nowIso(), id)
        .first();
    }
    if (!row) return null;
    if (patch.embedding && patch.embedding.length) {
      await this.vectorizeInquiries.upsert([{ id, values: patch.embedding }]);
    }
    return rowToInquiry(row);
  }
  async deleteInquiry(id: string): Promise<boolean> {
    const row = await this.db
      .prepare(`DELETE FROM inquiries WHERE id=? RETURNING id`)
      .bind(id)
      .first();
    if (!row) return false;
    await this.vectorizeInquiries.deleteByIds([id]);
    return true;
  }
  async listOpenInquiries(): Promise<Inquiry[]> {
    const { results } = await this.db
      .prepare(
        `SELECT ${INQ_COLS} FROM inquiries WHERE status IN ('open','matched') ORDER BY created_at DESC`,
      )
      .all();
    return (results as any[]).map(rowToInquiry);
  }
  async searchInquiries(embedding: number[], lim: number): Promise<ScoredInquiry[]> {
    const topK = Math.max(1, Math.min(50, lim * 4));
    const res = await this.vectorizeInquiries.query(embedding, { topK, returnValues: true });
    if (res.matches.length === 0) return [];
    const scoreById = new Map(
      res.matches.map((m) => [m.id, cosineSimilarity(embedding, Array.from(m.values ?? []))]),
    );
    const ids = res.matches.map((m) => m.id);
    const { results } = await this.db
      .prepare(`SELECT ${INQ_COLS} FROM inquiries WHERE id IN (${ids.map(() => "?").join(",")})`)
      .bind(...ids)
      .all();
    const scored = (results as any[])
      .map(rowToInquiry)
      .map((it) => ({ ...it, score: scoreById.get(it.id) ?? 0 }))
      .sort((a, b) => b.score - a.score);
    return scored.slice(0, Math.max(1, Math.min(200, lim)));
  }

  // --- matches ---
  async createMatch(m: Omit<Match, "id" | "created_at">): Promise<Match> {
    const id = newId();
    const created_at = nowIso();
    const row = await this.db
      .prepare(
        `INSERT INTO matches (id, item_id, inquiry_id, score, status, direction, created_at)
         VALUES (?,?,?,?,?,?,?)
         ON CONFLICT (item_id, inquiry_id) DO UPDATE SET score=excluded.score
         RETURNING ${MATCH_COLS}`,
      )
      .bind(id, m.item_id, m.inquiry_id, m.score, m.status, m.direction, created_at)
      .first();
    return rowToMatch(row);
  }
  async listMatches(status?: string): Promise<Match[]> {
    const { results } = status
      ? await this.db
          .prepare(`SELECT ${MATCH_COLS} FROM matches WHERE status=? ORDER BY created_at DESC`)
          .bind(status)
          .all()
      : await this.db.prepare(`SELECT ${MATCH_COLS} FROM matches ORDER BY created_at DESC`).all();
    return (results as any[]).map(rowToMatch);
  }
  async getMatch(id: string): Promise<Match | null> {
    const row = await this.db
      .prepare(`SELECT ${MATCH_COLS} FROM matches WHERE id=?`)
      .bind(id)
      .first();
    return row ? rowToMatch(row) : null;
  }
  async updateMatch(id: string, patch: Partial<Match>): Promise<Match | null> {
    const { set, params } = buildSet(patch, ["status"]);
    if (!set) {
      const row = await this.db
        .prepare(`SELECT ${MATCH_COLS} FROM matches WHERE id=?`)
        .bind(id)
        .first();
      return row ? rowToMatch(row) : null;
    }
    const row = await this.db
      .prepare(`UPDATE matches SET ${set} WHERE id=? RETURNING ${MATCH_COLS}`)
      .bind(...params, id)
      .first();
    return row ? rowToMatch(row) : null;
  }
  async findMatch(itemId: string, inquiryId: string): Promise<Match | null> {
    const row = await this.db
      .prepare(`SELECT ${MATCH_COLS} FROM matches WHERE item_id=? AND inquiry_id=?`)
      .bind(itemId, inquiryId)
      .first();
    return row ? rowToMatch(row) : null;
  }

  // --- notifications ---
  async createNotification(
    n: Omit<Notification, "id" | "created_at" | "read">,
  ): Promise<Notification> {
    const id = newId();
    const created_at = nowIso();
    const row = await this.db
      .prepare(
        `INSERT INTO notifications (id, type, title, body, ref_item_id, ref_inquiry_id, ref_match_id, read, created_at)
         VALUES (?,?,?,?,?,?,?,0,?)
         RETURNING ${NOTIF_COLS}`,
      )
      .bind(id, n.type, n.title, n.body, n.ref_item_id, n.ref_inquiry_id, n.ref_match_id, created_at)
      .first();
    return rowToNotif(row);
  }
  async listNotifications(unreadOnly = false): Promise<Notification[]> {
    const { results } = unreadOnly
      ? await this.db
          .prepare(`SELECT ${NOTIF_COLS} FROM notifications WHERE read=0 ORDER BY created_at DESC`)
          .all()
      : await this.db
          .prepare(`SELECT ${NOTIF_COLS} FROM notifications ORDER BY created_at DESC`)
          .all();
    return (results as any[]).map(rowToNotif);
  }
  async markNotificationRead(id: string): Promise<boolean> {
    const row = await this.db
      .prepare(`UPDATE notifications SET read=1 WHERE id=? RETURNING id`)
      .bind(id)
      .first();
    return !!row;
  }
  async unreadCount(): Promise<number> {
    const row = await this.db
      .prepare(`SELECT count(*) AS c FROM notifications WHERE read=0`)
      .first<{ c: number }>();
    return row?.c ?? 0;
  }

  // --- settings ---
  async getSetting(key: string): Promise<string | null> {
    const row = await this.db
      .prepare(`SELECT value FROM settings WHERE key=?`)
      .bind(key)
      .first<{ value: string }>();
    return row?.value ?? null;
  }
  async setSetting(key: string, value: string): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO settings (key, value) VALUES (?,?)
         ON CONFLICT (key) DO UPDATE SET value=excluded.value`,
      )
      .bind(key, value)
      .run();
  }
}

// ---- column lists & row mappers ----
const ITEM_COLS =
  "id, display_id, status, category, color, brand, found_location, found_at, map_key, found_x, found_y, storage_location, image_keys, ai_description, tags, notes, created_at, updated_at";
const INQ_COLS =
  "id, status, description, category, color, ai_description, tags, reference_no, notes, matched_item_id, created_at, updated_at";
const MATCH_COLS = "id, item_id, inquiry_id, score, status, direction, created_at";
const NOTIF_COLS =
  "id, type, title, body, ref_item_id, ref_inquiry_id, ref_match_id, read, created_at";

// 更新可能フィールド(near-direct DB edit を許容)。embedding は D1 に列が無いので含めない
// (呼び出し側の patch.embedding は updateItem/updateInquiry 内で個別に Vectorize へ upsert する)。
const ITEM_FIELDS = [
  "display_id", "status", "category", "color", "brand", "found_location", "found_at",
  "map_key", "found_x", "found_y",
  "storage_location", "image_keys", "ai_description", "tags", "notes",
];
const INQ_FIELDS = [
  "status", "description", "category", "color", "ai_description", "tags",
  "reference_no", "notes", "matched_item_id",
];
const JSON_FIELDS = new Set(["image_keys", "tags"]);

function arr(v: any): any[] {
  if (Array.isArray(v)) return v;
  if (typeof v === "string") {
    try {
      return JSON.parse(v);
    } catch {
      return [];
    }
  }
  return [];
}

function rowToItem(r: any): Item {
  return {
    id: r.id,
    display_id: r.display_id ?? "",
    status: r.status,
    category: r.category,
    color: r.color,
    brand: r.brand,
    found_location: r.found_location,
    found_at: r.found_at ?? null,
    map_key: r.map_key ?? "",
    found_x: r.found_x != null ? Number(r.found_x) : null,
    found_y: r.found_y != null ? Number(r.found_y) : null,
    storage_location: r.storage_location,
    image_keys: arr(r.image_keys),
    ai_description: r.ai_description,
    tags: arr(r.tags),
    embedding: [],
    notes: r.notes,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}
function rowToInquiry(r: any): Inquiry {
  return {
    id: r.id,
    status: r.status,
    description: r.description,
    category: r.category,
    color: r.color,
    ai_description: r.ai_description,
    tags: arr(r.tags),
    embedding: [],
    reference_no: r.reference_no,
    notes: r.notes,
    matched_item_id: r.matched_item_id ?? null,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}
function rowToMatch(r: any): Match {
  return {
    id: r.id,
    item_id: r.item_id,
    inquiry_id: r.inquiry_id,
    score: Number(r.score),
    status: r.status,
    direction: r.direction,
    created_at: r.created_at,
  };
}
function rowToNotif(r: any): Notification {
  return {
    id: r.id,
    type: r.type,
    title: r.title,
    body: r.body,
    ref_item_id: r.ref_item_id ?? null,
    ref_inquiry_id: r.ref_inquiry_id ?? null,
    ref_match_id: r.ref_match_id ?? null,
    read: !!r.read,
    created_at: r.created_at,
  };
}

function limit(f: SearchFilters, def: number): number {
  const n = f.limit ?? def;
  return Math.max(1, Math.min(1000, n));
}

function buildItemWhere(f: SearchFilters): { where: string; params: any[] } {
  const clauses: string[] = [];
  const params: any[] = [];
  if (f.category) {
    clauses.push("category = ?");
    params.push(f.category);
  }
  if (f.color) {
    clauses.push("color = ?");
    params.push(f.color);
  }
  if (f.status) {
    clauses.push("status = ?");
    params.push(f.status);
  }
  if (f.location) {
    clauses.push("found_location LIKE ?");
    params.push(`%${f.location}%`);
  }
  if (f.from) {
    clauses.push("found_at >= ?");
    params.push(f.from);
  }
  if (f.to) {
    clauses.push("found_at <= ?");
    params.push(f.to);
  }
  return { where: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "", params };
}

function buildSet(
  patch: Record<string, any>,
  allowed: string[],
): { set: string; params: any[] } {
  const parts: string[] = [];
  const params: any[] = [];
  for (const key of allowed) {
    if (!(key in patch) || patch[key] === undefined) continue;
    const val = patch[key];
    parts.push(`${key} = ?`);
    params.push(JSON_FIELDS.has(key) ? JSON.stringify(val ?? []) : val);
  }
  return { set: parts.join(", "), params };
}
