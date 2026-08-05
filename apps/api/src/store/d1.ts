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
  type MatchBulkEntry,
  type MatchDecision,
  type MatchDecisionResult,
  type UpdateOptions,
  VectorMetadataSyncError,
  nowIso,
  newId,
} from "./store.ts";
import { applyItemFilters } from "./memory.ts";
import { cosineSimilarity } from "../lib/vector.ts";
import { mapDisplayIdWriteError } from "./errors.ts";
import {
  normalizeItemPageLimit,
  parseItemCursor,
  toItemPage,
  type ItemListOptions,
  type ItemPage,
} from "./item-pagination.ts";

const VECTORIZE_SYNC_DELAYS_MS = [0, 100, 300] as const;
const VECTOR_METADATA_CONVERGENCE_WRITES = 3;
type StoreDatabase = Pick<D1Database, "prepare" | "batch">;
type StoreVectorize = Pick<Vectorize, "query" | "upsert" | "deleteByIds" | "getByIds">;

async function retryVectorizeSync(operation: () => Promise<unknown>): Promise<void> {
  let lastError: unknown;
  for (const delayMs of VECTORIZE_SYNC_DELAYS_MS) {
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
    try {
      await operation();
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError ?? new Error("Vectorize synchronization failed");
}

function vectorMetadata(row: { category?: unknown; status?: unknown }): Record<string, string> {
  return {
    category: String(row.category ?? ""),
    status: String(row.status ?? ""),
  };
}

function sameVectorMetadata(left: Record<string, string>, right: Record<string, string>): boolean {
  return left.category === right.category && left.status === right.status;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isConfirmationConflictError(error: unknown): boolean {
  return /UNIQUE constraint failed:\s*matches\.(?:id\b|item_id\s*,\s*matches\.inquiry_id\b)/i.test(
    errorMessage(error),
  );
}

/**
 * D1 + Vectorize 実装。D1 = 行データの永続化(source of truth)、
 * Vectorize = 埋め込みベクトルの近似最近傍検索専用(id と vector のみ保持)。
 * items と inquiries で意味空間が異なるため、Vectorize インデックスは2つ束ねる。
 * 埋め込みはクライアントへ返さない(pg 実装と同じ規約)。
 */
export class D1VectorizeStore implements Store {
  readonly kind = "d1" as const;
  constructor(
    private db: StoreDatabase,
    private vectorizeItems: StoreVectorize,
    private vectorizeInquiries: StoreVectorize,
  ) {}

  async init(): Promise<void> {
    // スキーマは `wrangler d1 migrations apply` で事前適用済みの前提。ここでは何もしない。
  }

  // --- items ---
  async createItem(d: NewItem): Promise<Item> {
    const id = newId();
    const created_at = nowIso();
    let row: any;
    try {
      row = await this.db
        .prepare(
          `INSERT INTO items
          (id, display_id, status, category, color, brand, found_location, found_at, map_key, found_x, found_y,
           image_keys, ai_description, tags, notes, ai_status, created_at, updated_at)
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
          JSON.stringify(d.image_keys ?? []),
          d.ai_description ?? "",
          JSON.stringify(d.tags ?? []),
          d.notes ?? "",
          d.ai_status ?? "ready",
          created_at,
          created_at,
        )
        .first();
    } catch (error) {
      throw mapDisplayIdWriteError(error);
    }
    const embedding = d.embedding;
    if (embedding && embedding.length) {
      try {
        await retryVectorizeSync(() =>
          this.vectorizeItems.upsert([
            {
              id,
              values: embedding,
              metadata: { category: d.category ?? "", status: d.status ?? "stored" },
            },
          ]),
        );
      } catch (e) {
        // Vectorize への反映が失敗した状態でD1側だけ行が残ると、検索に絶対ヒットしない
        // 「幽霊データ」になる（クライアントにはエラーが返るのに実は登録済み、という不整合）。
        // 呼び出し元には作成失敗として伝え、D1側も削除して整合を保つ。
        await this.db
          .prepare(`DELETE FROM items WHERE id=?`)
          .bind(id)
          .run()
          .catch(() => {});
        throw e;
      }
    }
    return rowToItem(row);
  }
  async getItem(id: string): Promise<Item | null> {
    const row = await this.db.prepare(`SELECT ${ITEM_COLS} FROM items WHERE id=?`).bind(id).first();
    return row ? rowToItem(row) : null;
  }
  async listItems(f: SearchFilters, options: ItemListOptions = {}): Promise<ItemPage> {
    const limit = normalizeItemPageLimit(options.limit);
    const cursor = options.cursor ? parseItemCursor(options.cursor) : null;
    const { where, params } = buildItemWhere(f, cursor);
    const { results } = await this.db
      .prepare(`SELECT ${ITEM_COLS} FROM items ${where} ORDER BY created_at DESC, id DESC LIMIT ?`)
      .bind(...params, limit + 1)
      .all();
    return toItemPage((results as any[]).map(rowToItem), limit);
  }
  async updateItem(
    id: string,
    patch: Partial<Item>,
    options: UpdateOptions = {},
  ): Promise<Item | null> {
    const { set, params } = buildSet(patch, ITEM_FIELDS);
    let row: any;
    if (!set) {
      row = await this.db.prepare(`SELECT ${ITEM_COLS} FROM items WHERE id=?`).bind(id).first();
    } else {
      try {
        row = await this.db
          .prepare(`UPDATE items SET ${set}, updated_at=? WHERE id=? RETURNING ${ITEM_COLS}`)
          .bind(...params, nowIso(), id)
          .first();
      } catch (error) {
        throw mapDisplayIdWriteError(error);
      }
    }
    if (!row) return null;
    if (options.syncVector !== false && patch.embedding && patch.embedding.length) {
      // metadata は upsert のたびに丸ごと差し替わるため、patch の断片ではなく
      // 更新後の行全体(row)から現在値を組み立てる(そうしないと今回patchに
      // 含まれなかった方のフィールドのメタデータが消えてしまう)。
      await this.upsertAppliedVector(
        "item",
        this.vectorizeItems,
        id,
        patch.embedding,
        vectorMetadata(row),
      );
    } else if (
      options.syncVector !== false &&
      (patch.status !== undefined || patch.category !== undefined)
    ) {
      await this.syncAppliedVectorMetadata("item", this.vectorizeItems, id);
    }
    return rowToItem(row);
  }
  async deleteItem(id: string): Promise<Item | null> {
    const results = await this.db.batch([
      this.prepareInquiryStateUpdate({ kind: "deleted_item", id }, nowIso()),
      this.db.prepare(`DELETE FROM items WHERE id=? RETURNING ${ITEM_COLS}`).bind(id),
    ]);
    const deletedRow = results[1]?.results?.[0];
    if (!deletedRow) return null;

    const inquiries = (results[0]?.results ?? []).map(rowToInquiry);
    const cleanupTargets = [
      {
        resource: "items_vectorize",
        entityId: id,
        run: () => this.vectorizeItems.deleteByIds([id]),
      },
      ...inquiries.map((inquiry) => ({
        resource: "inquiries_vectorize",
        entityId: inquiry.id,
        run: () => this.syncAppliedVectorMetadata("inquiry", this.vectorizeInquiries, inquiry.id),
      })),
    ];
    const cleanupResults = await Promise.allSettled(cleanupTargets.map((target) => target.run()));
    cleanupResults.forEach((result, index) => {
      if (result.status === "fulfilled") return;
      const target = cleanupTargets[index];
      if (!target) return;
      console.error(
        JSON.stringify({
          event: "deletion_cleanup_failed",
          resource: target.resource,
          entityId: target.entityId,
          applied: true,
          error: errorMessage(result.reason),
        }),
      );
    });
    return rowToItem(deletedRow);
  }
  async searchItems(embedding: number[], f: SearchFilters): Promise<ScoredItem[]> {
    // Vectorize のスコアは近似(quantization 由来の誤差があり閾値ぎりぎりの判定がぶれうる)。
    // returnValues で候補ベクトルを取得し、JS 側で厳密なコサイン類似度に置き換える。
    const topK = Math.max(1, Math.min(50, (f.limit ?? 50) * 4));
    const metaFilter: Record<string, string> = {};
    if (f.category) metaFilter.category = f.category;
    if (f.status) metaFilter.status = f.status;
    const res = await this.queryItemsWithFallback(embedding, topK, metaFilter);
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
  /**
   * カテゴリ/状態が指定されていれば Vectorize のメタデータフィルタで先に絞り込む。
   * 件数が増えると、類似はしているが種別違いの物品（例: スマホケースがスマホ本体の
   * 検索結果を埋める）が上位K件を占有し、本来ヒットすべき対象が漏れる「プレフィルタ問題」
   * が起きるため、クエリ時点で絞ることが重要。
   * ただし絞り込み対象のメタデータフィールドは Cloudflare 側で
   * `wrangler vectorize create-metadata-index` により事前にインデックス化されている必要があり、
   * 未作成だと filter 付きクエリ自体がエラーになる。その場合はフィルタ無しクエリにフォールバックし、
   * 呼び出し元の post-filter（applyItemFilters）に絞り込みを委ねる（結果は出るが上位K件問題は残る）。
   */
  private async queryItemsWithFallback(
    embedding: number[],
    topK: number,
    metaFilter: Record<string, string>,
  ) {
    if (Object.keys(metaFilter).length === 0) {
      return this.vectorizeItems.query(embedding, { topK, returnValues: true });
    }
    try {
      return await this.vectorizeItems.query(embedding, {
        topK,
        returnValues: true,
        filter: metaFilter,
      });
    } catch (e) {
      console.warn("[vectorize] items metadata filter failed, falling back to unfiltered query", e);
      return this.vectorizeItems.query(embedding, { topK, returnValues: true });
    }
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
    const embedding = d.embedding;
    if (embedding && embedding.length) {
      try {
        await retryVectorizeSync(() =>
          this.vectorizeInquiries.upsert([
            {
              id,
              values: embedding,
              metadata: { category: d.category ?? "", status: d.status ?? "open" },
            },
          ]),
        );
      } catch (e) {
        // createItem と同様、ベクトル未反映の幽霊データを残さないようD1側もロールバックする。
        await this.db
          .prepare(`DELETE FROM inquiries WHERE id=?`)
          .bind(id)
          .run()
          .catch(() => {});
        throw e;
      }
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
      : await this.db.prepare(`SELECT ${INQ_COLS} FROM inquiries ORDER BY created_at DESC`).all();
    return (results as any[]).map(rowToInquiry);
  }
  async updateInquiry(
    id: string,
    patch: Partial<Inquiry>,
    options: UpdateOptions = {},
  ): Promise<Inquiry | null> {
    const { set, params } = buildSet(patch, INQ_FIELDS);
    let row: any;
    if (!set) {
      row = await this.db.prepare(`SELECT ${INQ_COLS} FROM inquiries WHERE id=?`).bind(id).first();
    } else {
      row = await this.db
        .prepare(`UPDATE inquiries SET ${set}, updated_at=? WHERE id=? RETURNING ${INQ_COLS}`)
        .bind(...params, nowIso(), id)
        .first();
    }
    if (!row) return null;
    if (options.syncVector !== false && patch.embedding && patch.embedding.length) {
      await this.upsertAppliedVector(
        "inquiry",
        this.vectorizeInquiries,
        id,
        patch.embedding,
        vectorMetadata(row),
      );
    } else if (
      options.syncVector !== false &&
      (patch.status !== undefined || patch.category !== undefined)
    ) {
      await this.syncAppliedVectorMetadata("inquiry", this.vectorizeInquiries, id);
    }
    return rowToInquiry(row);
  }
  async deleteInquiry(id: string): Promise<boolean> {
    const row = await this.db
      .prepare(`DELETE FROM inquiries WHERE id=? RETURNING id`)
      .bind(id)
      .first();
    if (!row) return false;
    try {
      await this.vectorizeInquiries.deleteByIds([id]);
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "deletion_cleanup_failed",
          resource: "inquiries_vectorize",
          entityId: id,
          applied: true,
          error: errorMessage(error),
        }),
      );
    }
    return true;
  }
  async searchInquiries(
    embedding: number[],
    lim: number,
    filters?: { status?: string[] },
  ): Promise<ScoredInquiry[]> {
    const topK = Math.max(1, Math.min(50, lim * 4));
    const metaFilter = filters?.status?.length ? { status: { $in: filters.status } } : undefined;
    let res;
    try {
      res = metaFilter
        ? await this.vectorizeInquiries.query(embedding, {
            topK,
            returnValues: true,
            filter: metaFilter,
          })
        : await this.vectorizeInquiries.query(embedding, { topK, returnValues: true });
    } catch (e) {
      console.warn(
        "[vectorize] inquiries metadata filter failed, falling back to unfiltered query",
        e,
      );
      res = await this.vectorizeInquiries.query(embedding, { topK, returnValues: true });
    }
    if (res.matches.length === 0) return [];
    const scoreById = new Map(
      res.matches.map((m) => [m.id, cosineSimilarity(embedding, Array.from(m.values ?? []))]),
    );
    const ids = res.matches.map((m) => m.id);
    const { results } = await this.db
      .prepare(`SELECT ${INQ_COLS} FROM inquiries WHERE id IN (${ids.map(() => "?").join(",")})`)
      .bind(...ids)
      .all();
    const currentStatuses = filters?.status?.length ? new Set(filters.status) : null;
    const scored = (results as any[])
      .map(rowToInquiry)
      // Vectorize の metadata は反映待ちや同期失敗で古い可能性があるため、
      // 最終的な状態判定は正本である D1 の行に対してもう一度行う。
      .filter((inquiry) => !currentStatuses || currentStatuses.has(inquiry.status))
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
  async decideMatch(id: string, decision: MatchDecision): Promise<MatchDecisionResult> {
    const current = await this.getMatch(id);
    if (!current) return { ok: false, reason: "not_found" };

    const updated_at = nowIso();
    let results: D1Result[];
    try {
      results = await this.db.batch([
        // D1のバッチ処理は1つのトランザクションとして実行される。別の照合候補の確定があれば
        // 同じ主キーの挿入を意図的に発生させ、後続更新も含めて全体をロールバックする。
        this.db
          .prepare(
            `INSERT INTO matches (id, item_id, inquiry_id, score, status, direction, created_at)
             SELECT target.id, target.item_id, target.inquiry_id, target.score,
                    target.status, target.direction, target.created_at
             FROM matches AS target
             WHERE target.id=? AND ?='confirmed'
               AND EXISTS (
                 SELECT 1 FROM matches AS other
                 WHERE other.inquiry_id=target.inquiry_id
                   AND other.id<>target.id
                   AND other.status='confirmed'
               )`,
          )
          .bind(id, decision),
        this.db
          .prepare(
            `UPDATE matches SET status=?
             WHERE id=?
               AND EXISTS (SELECT 1 FROM inquiries WHERE id=matches.inquiry_id)
             RETURNING ${MATCH_COLS}`,
          )
          .bind(decision, id),
        this.prepareInquiryStateUpdate({ kind: "inquiry", id: current.inquiry_id }, updated_at),
      ]);
    } catch (error) {
      if (decision === "confirmed" && isConfirmationConflictError(error)) {
        return { ok: false, reason: "confirmation_conflict" };
      }
      throw error;
    }

    const matchRow = results[1]?.results?.[0];
    const inquiryRow = results[2]?.results?.[0];
    if (!matchRow) return { ok: false, reason: "not_found" };
    if (!inquiryRow) throw new Error(`照合 ${id} の問い合わせが見つかりません`);

    const match = rowToMatch(matchRow);
    const inquiry = rowToInquiry(inquiryRow);
    await this.syncAppliedVectorMetadata("inquiry", this.vectorizeInquiries, inquiry.id);
    return { ok: true, match, inquiry };
  }

  /** 照合判断と物品削除で共通の問い合わせ状態再計算をD1文として組み立てる。 */
  private prepareInquiryStateUpdate(
    target: { kind: "inquiry"; id: string } | { kind: "deleted_item"; id: string },
    updatedAt: string,
  ): D1PreparedStatement {
    const deletedItemId = target.kind === "deleted_item" ? target.id : null;
    const selection =
      target.kind === "inquiry"
        ? "id=?"
        : `EXISTS (SELECT 1 FROM items WHERE id=(SELECT item_id FROM target))
           AND (
             matched_item_id=(SELECT item_id FROM target)
             OR EXISTS (
               SELECT 1 FROM matches
               WHERE inquiry_id=inquiries.id
                 AND item_id=(SELECT item_id FROM target)
             )
           )`;
    const statement = this.db.prepare(
      `WITH target(item_id) AS (VALUES (?))
       UPDATE inquiries
       SET status=CASE
             WHEN status='closed' THEN 'closed'
             WHEN EXISTS (
               SELECT 1 FROM matches
               WHERE inquiry_id=inquiries.id
                 AND ((SELECT item_id FROM target) IS NULL
                      OR item_id<>(SELECT item_id FROM target))
                 AND status='confirmed'
             ) THEN 'resolved'
             WHEN EXISTS (
               SELECT 1 FROM matches
               WHERE inquiry_id=inquiries.id
                 AND ((SELECT item_id FROM target) IS NULL
                      OR item_id<>(SELECT item_id FROM target))
                 AND status='pending'
             ) THEN 'matched'
             ELSE 'open'
           END,
           matched_item_id=(
             SELECT item_id FROM matches
             WHERE inquiry_id=inquiries.id
               AND ((SELECT item_id FROM target) IS NULL
                    OR item_id<>(SELECT item_id FROM target))
               AND status='confirmed'
             ORDER BY created_at ASC, id ASC
             LIMIT 1
           ),
           updated_at=?
       WHERE ${selection}
       RETURNING ${INQ_COLS}`,
    );
    return target.kind === "inquiry"
      ? statement.bind(deletedItemId, updatedAt, target.id)
      : statement.bind(deletedItemId, updatedAt);
  }

  async findMatch(itemId: string, inquiryId: string): Promise<Match | null> {
    const row = await this.db
      .prepare(`SELECT ${MATCH_COLS} FROM matches WHERE item_id=? AND inquiry_id=?`)
      .bind(itemId, inquiryId)
      .first();
    return row ? rowToMatch(row) : null;
  }
  async createMatchesBulk(entries: MatchBulkEntry[]): Promise<Match[]> {
    if (entries.length === 0) return [];
    const created_at = nowIso();
    const stmts: D1PreparedStatement[] = [];
    const matches: Match[] = [];
    for (const e of entries) {
      const id = newId();
      stmts.push(
        this.db
          .prepare(
            `INSERT INTO matches (id, item_id, inquiry_id, score, status, direction, created_at)
             VALUES (?,?,?,?,?,?,?)
             ON CONFLICT (item_id, inquiry_id) DO UPDATE SET score=excluded.score`,
          )
          .bind(
            id,
            e.match.item_id,
            e.match.inquiry_id,
            e.match.score,
            e.match.status,
            e.match.direction,
            created_at,
          ),
      );
      matches.push({ id, ...e.match, created_at });
      if (e.inquiryStatusUpdate) {
        stmts.push(
          this.db
            .prepare(`UPDATE inquiries SET status=?, updated_at=? WHERE id=?`)
            .bind(e.inquiryStatusUpdate.status, created_at, e.inquiryStatusUpdate.id),
        );
      }
      stmts.push(
        this.db
          .prepare(
            `INSERT INTO notifications (id, type, title, body, ref_item_id, ref_inquiry_id, ref_match_id, read, created_at)
             VALUES (?,?,?,?,?,?,?,0,?)`,
          )
          .bind(
            newId(),
            e.notification.type,
            e.notification.title,
            e.notification.body,
            e.notification.ref_item_id,
            e.notification.ref_inquiry_id,
            id,
            created_at,
          ),
      );
    }
    // 件数分の直列ラウンドトリップを避け、1回の db.batch() にまとめる。
    await this.db.batch(stmts);

    // batch 内の問い合わせ状態更新は updateInquiry を通らないため、D1 確定後に
    // Vectorize metadata も同期する。全件を試してから最初の失敗を返すことで、
    // 一部の失敗が残りの問い合わせの修復を妨げないようにする。
    const inquiryIds = [
      ...new Set(
        entries
          .map((entry) => entry.inquiryStatusUpdate?.id)
          .filter((id): id is string => id !== undefined),
      ),
    ];
    const syncResults = await Promise.allSettled(
      inquiryIds.map(async (id) => {
        await this.syncAppliedVectorMetadata("inquiry", this.vectorizeInquiries, id);
      }),
    );
    const failedEntityIds = inquiryIds.filter(
      (_, index) => syncResults[index]?.status === "rejected",
    );
    if (failedEntityIds.length > 0) {
      // D1のbatchはすでに確定しているため、metadata同期障害でmatch作成全体を
      // 失敗扱いにしない。個別の同期失敗はrunAppliedVectorSyncが記録しており、
      // D1を正本として同値PATCHまたは再照合から修復できる。
      console.error(
        JSON.stringify({
          event: "vector_metadata_bulk_sync_partial",
          entity: "inquiry",
          entityIds: failedEntityIds,
          applied: true,
        }),
      );
    }
    return matches;
  }

  /** D1へ適用済みの埋め込み更新を、完全なmetadata付きでVectorizeへ反映する。 */
  private async upsertAppliedVector(
    entity: "item" | "inquiry",
    index: StoreVectorize,
    id: string,
    values: number[],
    metadata: Record<string, string>,
  ): Promise<void> {
    await this.runAppliedVectorSync(entity, id, () => index.upsert([{ id, values, metadata }]));
  }

  /** 既存vectorの値を再利用し、書き込み後もD1現在値へ収束するまでmetadataを同期する。 */
  private async syncAppliedVectorMetadata(
    entity: "item" | "inquiry",
    index: StoreVectorize,
    id: string,
  ): Promise<void> {
    await this.runAppliedVectorSync(entity, id, async () => {
      for (let write = 0; write < VECTOR_METADATA_CONVERGENCE_WRITES; write++) {
        const metadata = await this.readCurrentVectorMetadata(entity, id);
        if (!metadata) return;

        const vectors = await index.getByIds([id]);
        const current = vectors.find((vector) => vector.id === id);
        // vectorがない行は新規作成しない。再照合など明示的な再埋め込み経路に委ねる。
        if (!current) return;
        await index.upsert([
          {
            id,
            values: current.values,
            ...(current.namespace ? { namespace: current.namespace } : {}),
            metadata,
          },
        ]);

        // 別リクエストの古いupsertが新しい同期より後に完了しても、正本であるD1を
        // 書き込み後に再読し、変化していれば同じ試行内で最新値を再度反映する。
        const latest = await this.readCurrentVectorMetadata(entity, id);
        if (!latest) {
          // upsert待機中にD1行が削除された場合、その削除処理のdeleteByIdsより後に
          // 古いvectorが着地し得る。D1を再読して行消失を検知した側で再削除する。
          await index.deleteByIds([id]);
          return;
        }
        if (sameVectorMetadata(metadata, latest)) return;
      }

      throw new Error("Vectorize同期中にD1 metadataが継続して変更されました");
    });
  }

  private async readCurrentVectorMetadata(
    entity: "item" | "inquiry",
    id: string,
  ): Promise<Record<string, string> | null> {
    const row = entity === "item" ? await this.getItem(id) : await this.getInquiry(id);
    return row ? vectorMetadata(row) : null;
  }

  private async runAppliedVectorSync(
    entity: "item" | "inquiry",
    id: string,
    operation: () => Promise<unknown>,
  ): Promise<void> {
    try {
      await retryVectorizeSync(operation);
    } catch (cause) {
      console.error(
        JSON.stringify({
          event: "vector_metadata_sync_failed",
          entity,
          entityId: id,
          attempts: VECTORIZE_SYNC_DELAYS_MS.length,
          applied: true,
          error: errorMessage(cause),
        }),
      );
      throw new VectorMetadataSyncError(entity, id, VECTORIZE_SYNC_DELAYS_MS.length, cause);
    }
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
      .bind(
        id,
        n.type,
        n.title,
        n.body,
        n.ref_item_id,
        n.ref_inquiry_id,
        n.ref_match_id,
        created_at,
      )
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

  // --- counters ---
  async nextCounter(name: string, period: string, start: number): Promise<number> {
    // 単一のUPSERT文でアトミックに払い出す（read-modify-writeの競合を避ける）。
    // period が前回と同じなら +1、変わっていたら start にリセットして払い出す。
    // RETURNING は更新後の行を見るので、実際に払い出す値は next-1。
    const row = await this.db
      .prepare(
        `INSERT INTO counters (name, period, next) VALUES (?, ?, ? + 1)
         ON CONFLICT(name) DO UPDATE SET
           next = CASE WHEN counters.period = ? THEN counters.next + 1 ELSE ? + 1 END,
           period = ?
         RETURNING next - 1 AS issued`,
      )
      .bind(name, period, start, period, start, period)
      .first<{ issued: number }>();
    return row!.issued;
  }
}

// ---- column lists & row mappers ----
const ITEM_COLS =
  "id, display_id, status, category, color, brand, found_location, found_at, map_key, found_x, found_y, image_keys, ai_description, tags, notes, ai_status, created_at, updated_at";
const INQ_COLS =
  "id, status, description, category, color, ai_description, tags, reference_no, notes, matched_item_id, created_at, updated_at";
const MATCH_COLS = "id, item_id, inquiry_id, score, status, direction, created_at";
const NOTIF_COLS =
  "id, type, title, body, ref_item_id, ref_inquiry_id, ref_match_id, read, created_at";

// 更新可能フィールド(near-direct DB edit を許容)。embedding は D1 に列が無いので含めない
// (呼び出し側の patch.embedding は updateItem/updateInquiry 内で個別に Vectorize へ upsert する)。
const ITEM_FIELDS = [
  "display_id",
  "status",
  "category",
  "color",
  "brand",
  "found_location",
  "found_at",
  "map_key",
  "found_x",
  "found_y",
  "image_keys",
  "ai_description",
  "tags",
  "notes",
  "ai_status",
];
const INQ_FIELDS = [
  "status",
  "description",
  "category",
  "color",
  "ai_description",
  "tags",
  "reference_no",
  "notes",
  "matched_item_id",
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
    image_keys: arr(r.image_keys),
    ai_description: r.ai_description,
    tags: arr(r.tags),
    embedding: [],
    notes: r.notes,
    ai_status: r.ai_status ?? "ready",
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

function buildItemWhere(
  f: SearchFilters,
  cursor?: { createdAt: string; id: string } | null,
): { where: string; params: any[] } {
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
  if (cursor) {
    clauses.push("(created_at < ? OR (created_at = ? AND id < ?))");
    params.push(cursor.createdAt, cursor.createdAt, cursor.id);
  }
  return { where: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "", params };
}

function buildSet(patch: Record<string, any>, allowed: string[]): { set: string; params: any[] } {
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
