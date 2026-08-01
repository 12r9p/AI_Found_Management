import { expect, test } from "bun:test";
import { createApp } from "../app.ts";
import { resolveConfig } from "../config.ts";
import type { AppContext } from "../context.ts";
import type { AIProvider } from "../ai/provider.ts";
import type { ImageStorage } from "../storage/images.ts";
import type { Item, Inquiry } from "../types.ts";
import { D1VectorizeStore } from "./d1.ts";

type StoredRow = Record<string, unknown>;

/** テスト対象のSQLだけをD1のメソッド形状で記録・実行するスタブ。 */
class RecordingD1 implements Pick<D1Database, "prepare" | "batch"> {
  readonly items = new Map<string, StoredRow>();
  readonly inquiries = new Map<string, StoredRow>();

  prepare(query: string): D1PreparedStatement {
    return new RecordingStatement(this, query);
  }

  async batch<T = unknown>(_statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
    return [];
  }

  first(query: string, values: unknown[], column?: string): unknown {
    const updatesItems = /UPDATE\s+items\s+SET/.test(query);
    const updatesInquiries = /UPDATE\s+inquiries\s+SET/.test(query);
    const id = String(values.at(-1));
    let row: StoredRow | undefined;
    if (query.includes("FROM items") || updatesItems) row = this.items.get(id);
    if (query.includes("FROM inquiries") || updatesInquiries) row = this.inquiries.get(id);
    if (!row) return null;
    if (updatesItems || updatesInquiries) this.applyUpdate(query, values, row);
    return column ? (row[column] ?? null) : { ...row };
  }

  all(query: string, values: unknown[]): StoredRow[] {
    const source = query.includes("FROM items") ? this.items : this.inquiries;
    return values.flatMap((value) => {
      const row = source.get(String(value));
      return row ? [{ ...row }] : [];
    });
  }

  private applyUpdate(query: string, values: unknown[], row: StoredRow): void {
    const setClause = query.match(/\bSET\s+([\s\S]+?)\s+WHERE\b/)?.[1] ?? "";
    const fields = setClause.split(",").map((part) => part.trim().split("=")[0].trim());
    fields.forEach((field, index) => {
      row[field] = values[index];
    });
  }
}

class RecordingStatement implements D1PreparedStatement {
  private values: unknown[] = [];

  constructor(
    private readonly db: RecordingD1,
    private readonly query: string,
  ) {}

  bind(...values: unknown[]): D1PreparedStatement {
    this.values = values;
    return this;
  }

  first<T = unknown>(colName: string): Promise<T | null>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  async first<T>(colName?: string): Promise<T | null> {
    return (this.db.first(this.query, this.values, colName) as T | null) ?? null;
  }

  async run<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    return d1Result([]);
  }

  async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    return d1Result(this.db.all(this.query, this.values) as T[]);
  }

  raw<T = unknown[]>(options: { columnNames: true }): Promise<[string[], ...T[]]>;
  raw<T = unknown[]>(options?: { columnNames?: false }): Promise<T[]>;
  async raw<T = unknown[]>(options?: { columnNames?: boolean }): Promise<T[] | [string[], ...T[]]> {
    return options?.columnNames ? [[]] : [];
  }
}

function d1Result<T>(results: T[]): D1Result<T> {
  return {
    success: true,
    meta: {
      duration: 0,
      size_after: 0,
      rows_read: 0,
      rows_written: 0,
      last_row_id: 0,
      changed_db: false,
      changes: 0,
    },
    results,
  };
}

/** getByIdsとupsertの呼び出しを保持し、一時失敗も再現するVectorizeスタブ。 */
class RecordingVectorize implements Pick<
  Vectorize,
  "query" | "upsert" | "deleteByIds" | "getByIds"
> {
  readonly vectors = new Map<string, VectorizeVector>();
  readonly upserts: VectorizeVector[][] = [];
  queryMatches: VectorizeMatch[] = [];
  getByIdsCalls = 0;
  upsertCalls = 0;
  failUpserts = 0;
  beforeUpsertApply?: (vectors: VectorizeVector[], call: number) => Promise<void>;

  async query(
    _vector: VectorFloatArray | number[],
    _options?: VectorizeQueryOptions,
  ): Promise<VectorizeMatches> {
    return { matches: this.queryMatches, count: this.queryMatches.length };
  }

  async upsert(vectors: VectorizeVector[]): Promise<VectorizeAsyncMutation> {
    const call = ++this.upsertCalls;
    const copied = vectors.map(copyVector);
    this.upserts.push(copied);
    if (this.failUpserts > 0) {
      this.failUpserts--;
      throw new Error("一時的なVectorize障害");
    }
    await this.beforeUpsertApply?.(copied, call);
    for (const vector of vectors) this.vectors.set(vector.id, copyVector(vector));
    return { mutationId: `upsert-${call}` };
  }

  async deleteByIds(ids: string[]): Promise<VectorizeAsyncMutation> {
    for (const id of ids) this.vectors.delete(id);
    return { mutationId: "delete-1" };
  }

  async getByIds(ids: string[]): Promise<VectorizeVector[]> {
    this.getByIdsCalls++;
    return ids.flatMap((id) => {
      const vector = this.vectors.get(id);
      return vector ? [copyVector(vector)] : [];
    });
  }
}

function copyVector(vector: VectorizeVector): VectorizeVector {
  return {
    id: vector.id,
    values: Array.from(vector.values),
    ...(vector.namespace ? { namespace: vector.namespace } : {}),
    ...(vector.metadata ? { metadata: structuredClone(vector.metadata) } : {}),
  };
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = () => {};
  const promise = new Promise<void>((fulfill) => {
    resolve = fulfill;
  });
  return { promise, resolve };
}

function itemRow(overrides: Partial<Item> & { id: string }): StoredRow {
  return {
    display_id: "FD-1",
    status: "stored",
    category: "財布",
    color: "黒",
    brand: "",
    found_location: "受付",
    found_at: null,
    map_key: "",
    found_x: null,
    found_y: null,
    image_keys: "[]",
    ai_description: "黒い財布",
    tags: "[]",
    notes: "",
    ai_status: "ready",
    created_at: "2026-08-01T00:00:00.000Z",
    updated_at: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

function inquiryRow(overrides: Partial<Inquiry> & { id: string }): StoredRow {
  return {
    status: "open",
    description: "黒い財布を紛失",
    category: "財布",
    color: "黒",
    ai_description: "黒い財布を紛失",
    tags: "[]",
    reference_no: "R-1",
    notes: "",
    matched_item_id: null,
    created_at: "2026-08-01T00:00:00.000Z",
    updated_at: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

function createStore(
  db: RecordingD1,
  items: RecordingVectorize,
  inquiries = new RecordingVectorize(),
) {
  return new D1VectorizeStore(db, items, inquiries);
}

const images: ImageStorage = {
  async put() {},
  async get() {
    return null;
  },
  async delete() {},
};

function contextFor(store: D1VectorizeStore, ai: AIProvider): AppContext {
  return { cfg: resolveConfig({}), store, ai, images };
}

test("物品状態の変更は既存vector値とnamespaceを保って完全なmetadataを再upsertする", async () => {
  const db = new RecordingD1();
  db.items.set("item-1", itemRow({ id: "item-1" }));
  const vectorize = new RecordingVectorize();
  vectorize.vectors.set("item-1", {
    id: "item-1",
    values: [0.1, 0.2, 0.3],
    namespace: "campus-a",
    metadata: { category: "古いカテゴリ", status: "stored", stale: "削除対象" },
  });

  const updated = await createStore(db, vectorize).updateItem("item-1", { status: "returned" });

  expect(updated?.status).toBe("returned");
  expect(vectorize.getByIdsCalls).toBe(1);
  expect(vectorize.upserts).toHaveLength(1);
  expect(vectorize.upserts[0][0]).toEqual({
    id: "item-1",
    values: [0.1, 0.2, 0.3],
    namespace: "campus-a",
    metadata: { category: "財布", status: "returned" },
  });
});

test("古いmetadataのupsertが新しい同期より後に完了してもD1現在値へ収束する", async () => {
  const db = new RecordingD1();
  db.items.set("item-1", itemRow({ id: "item-1" }));
  const vectorize = new RecordingVectorize();
  vectorize.vectors.set("item-1", {
    id: "item-1",
    values: [0.1, 0.2, 0.3],
    metadata: { category: "財布", status: "stored" },
  });
  const firstUpsertStarted = deferred();
  const releaseFirstUpsert = deferred();
  vectorize.beforeUpsertApply = async (_vectors, call) => {
    if (call !== 1) return;
    firstUpsertStarted.resolve();
    await releaseFirstUpsert.promise;
  };
  const olderStore = createStore(db, vectorize);
  const newerStore = createStore(db, vectorize);

  const olderUpdate = olderStore.updateItem("item-1", { status: "returned" });
  await firstUpsertStarted.promise;

  const newerUpdate = await newerStore.updateItem("item-1", { status: "disposed" });
  expect(newerUpdate?.status).toBe("disposed");
  expect(vectorize.vectors.get("item-1")?.metadata).toEqual({
    category: "財布",
    status: "disposed",
  });

  releaseFirstUpsert.resolve();
  await olderUpdate;

  expect(vectorize.upserts.map(([vector]) => vector.metadata?.status)).toEqual([
    "returned",
    "disposed",
    "disposed",
  ]);
  expect(vectorize.vectors.get("item-1")?.metadata).toEqual({
    category: "財布",
    status: "disposed",
  });
});

test("問い合わせ状態の変更もD1現在値からmetadata全体を再構築する", async () => {
  const db = new RecordingD1();
  db.inquiries.set("inquiry-1", inquiryRow({ id: "inquiry-1" }));
  const items = new RecordingVectorize();
  const inquiries = new RecordingVectorize();
  inquiries.vectors.set("inquiry-1", {
    id: "inquiry-1",
    values: [0.4, 0.5],
    metadata: { category: "財布", status: "open" },
  });

  const updated = await createStore(db, items, inquiries).updateInquiry("inquiry-1", {
    status: "matched",
  });

  expect(updated?.status).toBe("matched");
  expect(inquiries.upserts[0][0]).toEqual({
    id: "inquiry-1",
    values: [0.4, 0.5],
    metadata: { category: "財布", status: "matched" },
  });
});

test("問い合わせのmetadata変更時にvectorがなければ新規作成しない", async () => {
  const db = new RecordingD1();
  db.inquiries.set("inquiry-1", inquiryRow({ id: "inquiry-1" }));
  const items = new RecordingVectorize();
  const inquiries = new RecordingVectorize();

  const updated = await createStore(db, items, inquiries).updateInquiry("inquiry-1", {
    category: "カードケース",
  });

  expect(updated?.category).toBe("カードケース");
  expect(inquiries.getByIdsCalls).toBe(1);
  expect(inquiries.upsertCalls).toBe(0);
  expect(inquiries.vectors.size).toBe(0);
});

test("metadata同期が3回失敗すると503で適用済みを返し、同値PATCHから再試行できる", async () => {
  const db = new RecordingD1();
  db.items.set("item-1", itemRow({ id: "item-1" }));
  const vectorize = new RecordingVectorize();
  vectorize.vectors.set("item-1", { id: "item-1", values: [1, 0] });
  vectorize.failUpserts = 3;
  let embedCalls = 0;
  const ai: AIProvider = {
    name: "recording",
    async describeImages() {
      throw new Error("このテストでは使用しない");
    },
    async embed() {
      embedCalls++;
      return [9, 9];
    },
    async chat() {
      return "";
    },
  };
  const store = createStore(db, vectorize);
  const app = createApp(async () => contextFor(store, ai));
  const request = () =>
    new Request("http://localhost/api/items/item-1", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ category: "カードケース" }),
    });

  const failed = await app.fetch(request());
  expect(failed.status).toBe(503);
  expect(await failed.json()).toEqual({ error: "vector_metadata_sync_failed", applied: true });
  expect(vectorize.upsertCalls).toBe(3);
  expect(db.items.get("item-1")?.category).toBe("カードケース");
  expect(embedCalls).toBe(0);

  const retried = await app.fetch(request());
  expect(retried.status).toBe(200);
  expect(vectorize.upsertCalls).toBe(4);
  expect(vectorize.vectors.get("item-1")?.values).toEqual([1, 0]);
  expect(vectorize.vectors.get("item-1")?.metadata).toEqual({
    category: "カードケース",
    status: "stored",
  });
  expect(embedCalls).toBe(0);
});

test("Vectorizeの古い検索候補をD1の現在状態で再検証する", async () => {
  const db = new RecordingD1();
  db.items.set("item-stale", itemRow({ id: "item-stale", status: "returned" }));
  db.inquiries.set("inquiry-stale", inquiryRow({ id: "inquiry-stale", status: "resolved" }));
  const items = new RecordingVectorize();
  const inquiries = new RecordingVectorize();
  items.queryMatches = [{ id: "item-stale", score: 1, values: [1, 0] }];
  inquiries.queryMatches = [{ id: "inquiry-stale", score: 1, values: [1, 0] }];
  const store = createStore(db, items, inquiries);

  expect(await store.searchItems([1, 0], { status: "stored" })).toEqual([]);
  expect(await store.searchInquiries([1, 0], 10, { status: ["open", "matched"] })).toEqual([]);
});
