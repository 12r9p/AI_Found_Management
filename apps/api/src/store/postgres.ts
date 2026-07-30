import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import type {
  Item,
  Inquiry,
  Match,
  Notification,
  NewItem,
  NewInquiry,
  SearchFilters,
} from "../types.ts";
import { toPgVector } from "../lib/vector.ts";
import {
  type Store,
  type ScoredItem,
  type ScoredInquiry,
} from "./store.ts";
import { schemaSql } from "./schema.ts";

/**
 * Postgres + pgvector 実装。Neon serverless ドライバ経由（Workers/Bun 両対応）。
 * 類似度計算は SQL 側（<=> コサイン距離）で行い、埋め込みはクライアントへ返さない。
 */
// neon() の関数はタグ付きテンプレートに加え、パラメータ化クエリ用の
// .query(text, params) を実行時に持つ（型には未露出のため補う）。
type SqlFn = NeonQueryFunction<false, false> & {
  query: (text: string, params?: any[]) => Promise<any[]>;
};

export class PgStore implements Store {
  readonly kind = "postgres" as const;
  private sql: SqlFn;
  constructor(
    connectionString: string,
    private embedDim: number,
  ) {
    this.sql = neon(connectionString) as SqlFn;
  }

  async init(): Promise<void> {
    // スキーマは複数ステートメント。神経ドライバは1回1文なので分割実行。
    const stmts = schemaSql(this.embedDim)
      .split(/;\s*\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    for (const s of stmts) await this.sql.query(s);
  }

  private q(text: string, params: any[] = []) {
    return this.sql.query(text, params) as Promise<any[]>;
  }

  // --- items ---
  async createItem(d: NewItem): Promise<Item> {
    const rows = await this.q(
      `INSERT INTO items
        (display_id, status, category, color, brand, found_location, found_at, map_key, found_x, found_y,
         storage_location, image_keys, ai_description, tags, embedding, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14::jsonb,$15::vector,$16)
       RETURNING ${ITEM_COLS}`,
      [
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
        d.embedding && d.embedding.length ? toPgVector(d.embedding) : null,
        d.notes ?? "",
      ],
    );
    return rowToItem(rows[0]);
  }
  async getItem(id: string): Promise<Item | null> {
    const rows = await this.q(`SELECT ${ITEM_COLS} FROM items WHERE id=$1`, [id]);
    return rows[0] ? rowToItem(rows[0]) : null;
  }
  async listItems(f: SearchFilters): Promise<Item[]> {
    const { where, params } = buildItemWhere(f);
    const rows = await this.q(
      `SELECT ${ITEM_COLS} FROM items ${where} ORDER BY created_at DESC LIMIT ${limit(f, 500)}`,
      params,
    );
    return rows.map(rowToItem);
  }
  async updateItem(id: string, patch: Partial<Item>): Promise<Item | null> {
    const { set, params } = buildSet(patch, ITEM_FIELDS);
    if (!set) return this.getItem(id);
    params.push(id);
    const rows = await this.q(
      `UPDATE items SET ${set}, updated_at=now() WHERE id=$${params.length} RETURNING ${ITEM_COLS}`,
      params,
    );
    return rows[0] ? rowToItem(rows[0]) : null;
  }
  async deleteItem(id: string): Promise<boolean> {
    const rows = await this.q(`DELETE FROM items WHERE id=$1 RETURNING id`, [id]);
    return rows.length > 0;
  }
  async searchItems(embedding: number[], f: SearchFilters): Promise<ScoredItem[]> {
    const { where, params } = buildItemWhere(f);
    params.push(toPgVector(embedding));
    const vecParam = `$${params.length}::vector`;
    const rows = await this.q(
      `SELECT ${ITEM_COLS}, 1 - (embedding <=> ${vecParam}) AS score
       FROM items ${where} ${where ? "AND" : "WHERE"} embedding IS NOT NULL
       ORDER BY embedding <=> ${vecParam} LIMIT ${limit(f, 50)}`,
      params,
    );
    return rows.map((r) => ({ ...rowToItem(r), score: Number(r.score) }));
  }

  // --- inquiries ---
  async createInquiry(d: NewInquiry): Promise<Inquiry> {
    const rows = await this.q(
      `INSERT INTO inquiries
        (status, description, category, color, ai_description, tags, embedding,
         reference_no, notes, matched_item_id)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::vector,$8,$9,$10)
       RETURNING ${INQ_COLS}`,
      [
        d.status ?? "open",
        d.description ?? "",
        d.category ?? "",
        d.color ?? "",
        d.ai_description ?? "",
        JSON.stringify(d.tags ?? []),
        d.embedding && d.embedding.length ? toPgVector(d.embedding) : null,
        d.reference_no ?? "",
        d.notes ?? "",
        d.matched_item_id ?? null,
      ],
    );
    return rowToInquiry(rows[0]);
  }
  async getInquiry(id: string): Promise<Inquiry | null> {
    const rows = await this.q(`SELECT ${INQ_COLS} FROM inquiries WHERE id=$1`, [id]);
    return rows[0] ? rowToInquiry(rows[0]) : null;
  }
  async listInquiries(status?: string): Promise<Inquiry[]> {
    const rows = status
      ? await this.q(
          `SELECT ${INQ_COLS} FROM inquiries WHERE status=$1 ORDER BY created_at DESC`,
          [status],
        )
      : await this.q(`SELECT ${INQ_COLS} FROM inquiries ORDER BY created_at DESC`);
    return rows.map(rowToInquiry);
  }
  async updateInquiry(id: string, patch: Partial<Inquiry>): Promise<Inquiry | null> {
    const { set, params } = buildSet(patch, INQ_FIELDS);
    if (!set) return this.getInquiry(id);
    params.push(id);
    const rows = await this.q(
      `UPDATE inquiries SET ${set}, updated_at=now() WHERE id=$${params.length} RETURNING ${INQ_COLS}`,
      params,
    );
    return rows[0] ? rowToInquiry(rows[0]) : null;
  }
  async deleteInquiry(id: string): Promise<boolean> {
    const rows = await this.q(`DELETE FROM inquiries WHERE id=$1 RETURNING id`, [id]);
    return rows.length > 0;
  }
  async listOpenInquiries(): Promise<Inquiry[]> {
    const rows = await this.q(
      `SELECT ${INQ_COLS} FROM inquiries WHERE status IN ('open','matched') ORDER BY created_at DESC`,
    );
    return rows.map(rowToInquiry);
  }
  async searchInquiries(embedding: number[], lim: number): Promise<ScoredInquiry[]> {
    const rows = await this.q(
      `SELECT ${INQ_COLS}, 1 - (embedding <=> $1::vector) AS score
       FROM inquiries WHERE embedding IS NOT NULL
       ORDER BY embedding <=> $1::vector LIMIT ${Math.max(1, Math.min(200, lim))}`,
      [toPgVector(embedding)],
    );
    return rows.map((r) => ({ ...rowToInquiry(r), score: Number(r.score) }));
  }

  // --- matches ---
  async createMatch(m: Omit<Match, "id" | "created_at">): Promise<Match> {
    const rows = await this.q(
      `INSERT INTO matches (item_id, inquiry_id, score, status, direction)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (item_id, inquiry_id) DO UPDATE SET score=EXCLUDED.score
       RETURNING ${MATCH_COLS}`,
      [m.item_id, m.inquiry_id, m.score, m.status, m.direction],
    );
    return rowToMatch(rows[0]);
  }
  async listMatches(status?: string): Promise<Match[]> {
    const rows = status
      ? await this.q(
          `SELECT ${MATCH_COLS} FROM matches WHERE status=$1 ORDER BY created_at DESC`,
          [status],
        )
      : await this.q(`SELECT ${MATCH_COLS} FROM matches ORDER BY created_at DESC`);
    return rows.map(rowToMatch);
  }
  async getMatch(id: string): Promise<Match | null> {
    const rows = await this.q(`SELECT ${MATCH_COLS} FROM matches WHERE id=$1`, [id]);
    return rows[0] ? rowToMatch(rows[0]) : null;
  }
  async updateMatch(id: string, patch: Partial<Match>): Promise<Match | null> {
    const { set, params } = buildSet(patch, ["status"]);
    if (!set) return this.getMatch(id);
    params.push(id);
    const rows = await this.q(
      `UPDATE matches SET ${set} WHERE id=$${params.length} RETURNING ${MATCH_COLS}`,
      params,
    );
    return rows[0] ? rowToMatch(rows[0]) : null;
  }
  async findMatch(itemId: string, inquiryId: string): Promise<Match | null> {
    const rows = await this.q(
      `SELECT ${MATCH_COLS} FROM matches WHERE item_id=$1 AND inquiry_id=$2`,
      [itemId, inquiryId],
    );
    return rows[0] ? rowToMatch(rows[0]) : null;
  }

  // --- notifications ---
  async createNotification(
    n: Omit<Notification, "id" | "created_at" | "read">,
  ): Promise<Notification> {
    const rows = await this.q(
      `INSERT INTO notifications (type, title, body, ref_item_id, ref_inquiry_id, ref_match_id)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING ${NOTIF_COLS}`,
      [n.type, n.title, n.body, n.ref_item_id, n.ref_inquiry_id, n.ref_match_id],
    );
    return rowToNotif(rows[0]);
  }
  async listNotifications(unreadOnly = false): Promise<Notification[]> {
    const rows = unreadOnly
      ? await this.q(
          `SELECT ${NOTIF_COLS} FROM notifications WHERE read=false ORDER BY created_at DESC`,
        )
      : await this.q(`SELECT ${NOTIF_COLS} FROM notifications ORDER BY created_at DESC`);
    return rows.map(rowToNotif);
  }
  async markNotificationRead(id: string): Promise<boolean> {
    const rows = await this.q(
      `UPDATE notifications SET read=true WHERE id=$1 RETURNING id`,
      [id],
    );
    return rows.length > 0;
  }
  async unreadCount(): Promise<number> {
    const rows = await this.q(`SELECT count(*)::int AS c FROM notifications WHERE read=false`);
    return rows[0]?.c ?? 0;
  }

  // --- settings ---
  async getSetting(key: string): Promise<string | null> {
    const rows = await this.q(`SELECT value FROM settings WHERE key=$1`, [key]);
    return rows[0]?.value ?? null;
  }
  async setSetting(key: string, value: string): Promise<void> {
    await this.q(
      `INSERT INTO settings (key, value) VALUES ($1,$2)
       ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value`,
      [key, value],
    );
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

// 更新可能フィールド（near-direct DB edit を許容）
const ITEM_FIELDS = [
  "display_id", "status", "category", "color", "brand", "found_location", "found_at",
  "map_key", "found_x", "found_y",
  "storage_location", "image_keys", "ai_description", "tags", "embedding", "notes",
];
const INQ_FIELDS = [
  "status", "description", "category", "color", "ai_description", "tags",
  "embedding", "reference_no", "notes", "matched_item_id",
];
const JSON_FIELDS = new Set(["image_keys", "tags"]);

function iso(v: any): string {
  if (!v) return "";
  return v instanceof Date ? v.toISOString() : String(v);
}
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
    found_at: r.found_at ? iso(r.found_at) : null,
    map_key: r.map_key ?? "",
    found_x: r.found_x != null ? Number(r.found_x) : null,
    found_y: r.found_y != null ? Number(r.found_y) : null,
    storage_location: r.storage_location,
    image_keys: arr(r.image_keys),
    ai_description: r.ai_description,
    tags: arr(r.tags),
    embedding: [],
    notes: r.notes,
    created_at: iso(r.created_at),
    updated_at: iso(r.updated_at),
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
    created_at: iso(r.created_at),
    updated_at: iso(r.updated_at),
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
    created_at: iso(r.created_at),
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
    created_at: iso(r.created_at),
  };
}

function limit(f: SearchFilters, def: number): number {
  const n = f.limit ?? def;
  return Math.max(1, Math.min(1000, n));
}

function buildItemWhere(f: SearchFilters): { where: string; params: any[] } {
  const clauses: string[] = [];
  const params: any[] = [];
  const add = (sql: string, val: any) => {
    params.push(val);
    clauses.push(sql.replace("?", `$${params.length}`));
  };
  if (f.category) add("category = ?", f.category);
  if (f.color) add("color = ?", f.color);
  if (f.status) add("status = ?", f.status);
  if (f.location) add("found_location ILIKE ?", `%${f.location}%`);
  if (f.from) add("found_at >= ?", f.from);
  if (f.to) add("found_at <= ?", f.to);
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
    let val = patch[key];
    let placeholder: string;
    if (JSON_FIELDS.has(key)) {
      params.push(JSON.stringify(val ?? []));
      placeholder = `$${params.length}::jsonb`;
    } else if (key === "embedding") {
      params.push(val && val.length ? toPgVector(val) : null);
      placeholder = `$${params.length}::vector`;
    } else {
      params.push(val);
      placeholder = `$${params.length}`;
    }
    parts.push(`${key} = ${placeholder}`);
  }
  return { set: parts.join(", "), params };
}
