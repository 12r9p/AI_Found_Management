import { Database, type SQLQueryBindings } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import type { AIProvider } from "../ai/provider.ts";
import { createApp } from "../app.ts";
import { resolveConfig } from "../config.ts";
import type { AppContext } from "../context.ts";
import type { ImageStorage } from "../storage/images.ts";
import type { Inquiry, Match } from "../types.ts";
import { D1VectorizeStore } from "./d1.ts";
import { MemoryStore } from "./memory.ts";
import type { Store } from "./store.ts";

/** 実際のSQLiteトランザクションでD1のバッチ処理の原子性を再現するテスト用アダプター。 */
class SqliteD1 implements Pick<D1Database, "prepare" | "batch"> {
  readonly sqlite = new Database(":memory:");

  constructor() {
    this.sqlite.exec(`
      CREATE TABLE items (
        id TEXT PRIMARY KEY,
        display_id TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'stored',
        category TEXT NOT NULL DEFAULT '',
        color TEXT NOT NULL DEFAULT '',
        brand TEXT NOT NULL DEFAULT '',
        found_location TEXT NOT NULL DEFAULT '',
        found_at TEXT,
        map_key TEXT NOT NULL DEFAULT '',
        found_x REAL,
        found_y REAL,
        image_keys TEXT NOT NULL DEFAULT '[]',
        ai_description TEXT NOT NULL DEFAULT '',
        tags TEXT NOT NULL DEFAULT '[]',
        notes TEXT NOT NULL DEFAULT '',
        ai_status TEXT NOT NULL DEFAULT 'ready',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE inquiries (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL DEFAULT 'open',
        description TEXT NOT NULL DEFAULT '',
        category TEXT NOT NULL DEFAULT '',
        color TEXT NOT NULL DEFAULT '',
        ai_description TEXT NOT NULL DEFAULT '',
        tags TEXT NOT NULL DEFAULT '[]',
        reference_no TEXT NOT NULL DEFAULT '',
        notes TEXT NOT NULL DEFAULT '',
        matched_item_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE matches (
        id TEXT PRIMARY KEY,
        item_id TEXT NOT NULL,
        inquiry_id TEXT NOT NULL,
        score REAL NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        direction TEXT NOT NULL DEFAULT 'item_to_inquiry',
        created_at TEXT NOT NULL,
        UNIQUE (item_id, inquiry_id)
      );
    `);
  }

  prepare(query: string): D1PreparedStatement {
    return new SqliteD1Statement(this, query);
  }

  async batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
    const execute = this.sqlite.transaction((pending: D1PreparedStatement[]) =>
      pending.map((statement) => (statement as SqliteD1Statement).execute<T>()),
    );
    return execute.immediate(statements);
  }

  close(): void {
    this.sqlite.close();
  }
}

class SqliteD1Statement implements D1PreparedStatement {
  private values: unknown[] = [];

  constructor(
    private readonly db: SqliteD1,
    private readonly query: string,
  ) {}

  bind(...values: unknown[]): D1PreparedStatement {
    this.values = values;
    return this;
  }

  first<T = unknown>(colName: string): Promise<T | null>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  async first<T>(colName?: string): Promise<T | null> {
    const row = this.statement().get(...this.bindings()) as Record<string, unknown> | null;
    if (!row) return null;
    return (colName ? row[colName] : row) as T;
  }

  async run<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    const changes = this.statement().run(...this.bindings());
    return d1Result([], changes.changes);
  }

  async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    return this.execute<T>();
  }

  raw<T = unknown[]>(options: { columnNames: true }): Promise<[string[], ...T[]]>;
  raw<T = unknown[]>(options?: { columnNames?: false }): Promise<T[]>;
  async raw<T = unknown[]>(options?: { columnNames?: boolean }): Promise<T[] | [string[], ...T[]]> {
    const statement = this.statement();
    const rows = statement.values(...this.bindings()) as T[];
    return options?.columnNames ? [statement.columnNames, ...rows] : rows;
  }

  execute<T>(): D1Result<T> {
    const results = this.statement().all(...this.bindings()) as T[];
    return d1Result(results);
  }

  private statement() {
    return this.db.sqlite.prepare(this.query);
  }

  private bindings(): SQLQueryBindings[] {
    return this.values as SQLQueryBindings[];
  }
}

function d1Result<T>(results: T[], changes = 0): D1Result<T> {
  return {
    success: true,
    meta: {
      duration: 0,
      size_after: 0,
      rows_read: 0,
      rows_written: changes,
      last_row_id: 0,
      changed_db: changes > 0,
      changes,
    },
    results,
  };
}

class TestVectorize implements Pick<Vectorize, "query" | "upsert" | "deleteByIds" | "getByIds"> {
  readonly vectors = new Map<string, VectorizeVector>();
  readonly upserts: VectorizeVector[][] = [];
  upsertCalls = 0;
  failUpserts = 0;

  async query(): Promise<VectorizeMatches> {
    return { count: 0, matches: [] };
  }

  async upsert(vectors: VectorizeVector[]): Promise<VectorizeAsyncMutation> {
    this.upsertCalls++;
    const copied = vectors.map(copyVector);
    this.upserts.push(copied);
    if (this.failUpserts > 0) {
      this.failUpserts--;
      throw new Error("一時的なVectorize障害");
    }
    for (const vector of copied) this.vectors.set(vector.id, vector);
    return { mutationId: `upsert-${this.upsertCalls}` };
  }

  async deleteByIds(ids: string[]): Promise<VectorizeAsyncMutation> {
    for (const id of ids) this.vectors.delete(id);
    return { mutationId: "delete-1" };
  }

  async getByIds(ids: string[]): Promise<VectorizeVector[]> {
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

type TestStore = {
  store: Store;
  inquiriesVectorize?: TestVectorize;
  close(): void;
};

const storeFactories: [string, () => TestStore][] = [
  [
    "メモリストア",
    () => ({
      store: new MemoryStore(),
      close() {},
    }),
  ],
  [
    "D1ストア",
    () => {
      const db = new SqliteD1();
      const inquiriesVectorize = new TestVectorize();
      return {
        store: new D1VectorizeStore(db, new TestVectorize(), inquiriesVectorize),
        inquiriesVectorize,
        close: () => db.close(),
      };
    },
  ],
];

async function seedDecisionScenario(store: Store) {
  const firstItem = await store.createItem({ display_id: "FD-1", category: "財布" });
  const secondItem = await store.createItem({ display_id: "FD-2", category: "財布" });
  const inquiry = await store.createInquiry({
    status: "matched",
    description: "黒い財布",
    category: "財布",
    reference_no: "R-1",
  });
  const firstMatch = await store.createMatch({
    item_id: firstItem.id,
    inquiry_id: inquiry.id,
    score: 0.9,
    status: "pending",
    direction: "item_to_inquiry",
  });
  const secondMatch = await store.createMatch({
    item_id: secondItem.id,
    inquiry_id: inquiry.id,
    score: 0.8,
    status: "pending",
    direction: "item_to_inquiry",
  });
  return { firstItem, secondItem, inquiry, firstMatch, secondMatch };
}

for (const [storeName, createStore] of storeFactories) {
  describe(storeName, () => {
    test("同じ判断と逆判断を冪等に処理し、問い合わせ状態を全候補から再計算する", async () => {
      const fixture = createStore();
      try {
        const { store } = fixture;
        const { firstItem, inquiry, firstMatch, secondMatch } = await seedDecisionScenario(store);

        const confirmed = await store.decideMatch(firstMatch.id, "confirmed");
        expect(confirmed).toMatchObject({
          ok: true,
          match: { id: firstMatch.id, status: "confirmed" },
          inquiry: {
            id: inquiry.id,
            status: "resolved",
            matched_item_id: firstItem.id,
          },
        });

        const repeated = await store.decideMatch(firstMatch.id, "confirmed");
        expect(repeated).toMatchObject({
          ok: true,
          match: { status: "confirmed" },
          inquiry: { status: "resolved", matched_item_id: firstItem.id },
        });

        const reversed = await store.decideMatch(firstMatch.id, "rejected");
        expect(reversed).toMatchObject({
          ok: true,
          inquiry: { status: "matched", matched_item_id: null },
        });

        const noCandidates = await store.decideMatch(secondMatch.id, "rejected");
        expect(noCandidates).toMatchObject({
          ok: true,
          inquiry: { status: "open", matched_item_id: null },
        });

        const confirmedAgain = await store.decideMatch(firstMatch.id, "confirmed");
        expect(confirmedAgain).toMatchObject({
          ok: true,
          inquiry: { status: "resolved", matched_item_id: firstItem.id },
        });
      } finally {
        fixture.close();
      }
    });

    test("別候補の確定は競合として全変更を取り消し、確定済み候補は維持する", async () => {
      const fixture = createStore();
      try {
        const { store } = fixture;
        const { firstItem, secondItem, inquiry, firstMatch, secondMatch } =
          await seedDecisionScenario(store);
        await store.decideMatch(firstMatch.id, "confirmed");
        const before = {
          first: structuredClone(await store.getMatch(firstMatch.id)),
          second: structuredClone(await store.getMatch(secondMatch.id)),
          inquiry: structuredClone(await store.getInquiry(inquiry.id)),
        };

        expect(await store.decideMatch(secondMatch.id, "confirmed")).toEqual({
          ok: false,
          reason: "confirmation_conflict",
        });
        expect(await store.getMatch(firstMatch.id)).toEqual(before.first);
        expect(await store.getMatch(secondMatch.id)).toEqual(before.second);
        expect(await store.getInquiry(inquiry.id)).toEqual(before.inquiry);

        const rejectedOther = await store.decideMatch(secondMatch.id, "rejected");
        expect(rejectedOther).toMatchObject({
          ok: true,
          inquiry: { status: "resolved", matched_item_id: firstItem.id },
        });

        await store.decideMatch(firstMatch.id, "rejected");
        const switched = await store.decideMatch(secondMatch.id, "confirmed");
        expect(switched).toMatchObject({
          ok: true,
          inquiry: { status: "resolved", matched_item_id: secondItem.id },
        });
      } finally {
        fixture.close();
      }
    });

    test("同じ問い合わせの候補を同時確定しても一方だけを確定する", async () => {
      const fixture = createStore();
      try {
        const { store } = fixture;
        const { inquiry, firstMatch, secondMatch } = await seedDecisionScenario(store);

        const results = await Promise.all([
          store.decideMatch(firstMatch.id, "confirmed"),
          store.decideMatch(secondMatch.id, "confirmed"),
        ]);

        expect(results.filter((result) => result.ok)).toHaveLength(1);
        expect(
          results.filter((result) => !result.ok && result.reason === "confirmation_conflict"),
        ).toHaveLength(1);
        expect(
          (await store.listMatches()).filter((match) => match.status === "confirmed"),
        ).toHaveLength(1);
        expect(await store.getInquiry(inquiry.id)).toMatchObject({ status: "resolved" });
      } finally {
        fixture.close();
      }
    });
  });
}

test("D1確定後に問い合わせベクトルの値を保ったまま現在状態を同期する", async () => {
  const fixture = storeFactories[1][1]();
  try {
    const { store, inquiriesVectorize } = fixture;
    const { inquiry, firstMatch } = await seedDecisionScenario(store);
    inquiriesVectorize!.vectors.set(inquiry.id, {
      id: inquiry.id,
      values: [0.25, 0.75],
      namespace: "campus-a",
      metadata: { category: "財布", status: "matched" },
    });

    await store.decideMatch(firstMatch.id, "confirmed");

    expect(inquiriesVectorize!.upserts.at(-1)?.[0]).toEqual({
      id: inquiry.id,
      values: [0.25, 0.75],
      namespace: "campus-a",
      metadata: { category: "財布", status: "resolved" },
    });
  } finally {
    fixture.close();
  }
});

const ai: AIProvider = {
  name: "test",
  async describeImages() {
    throw new Error("このテストでは使用しない");
  },
  async embed() {
    return [];
  },
  async chat() {
    return "";
  },
};

const images: ImageStorage = {
  async put() {},
  async get() {
    return null;
  },
  async delete() {},
};

function contextFor(store: Store): AppContext {
  return { cfg: resolveConfig({}), store, ai, images };
}

function patchMatch(app: ReturnType<typeof createApp>, id: string, body: unknown) {
  return app.fetch(
    new Request(`http://localhost/api/matches/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

test("PATCHはconfirmedとrejected以外を400で拒否する", async () => {
  const store = new MemoryStore();
  const app = createApp(async () => contextFor(store));

  for (const body of [{ status: "pending" }, { status: "resolved" }, {}]) {
    const response = await patchMatch(app, "match-1", body);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_match_status" });
  }
});

test("PATCHは未存在を404、別の照合候補の確定競合を409で返す", async () => {
  const store = new MemoryStore();
  const app = createApp(async () => contextFor(store));
  const missing = await patchMatch(app, "missing", { status: "confirmed" });
  expect(missing.status).toBe(404);
  expect(await missing.json()).toEqual({ error: "not found" });

  const { firstMatch, secondMatch } = await seedDecisionScenario(store);
  expect((await patchMatch(app, firstMatch.id, { status: "confirmed" })).status).toBe(200);
  const conflict = await patchMatch(app, secondMatch.id, { status: "confirmed" });
  expect(conflict.status).toBe(409);
  expect(await conflict.json()).toEqual({ error: "match_confirmation_conflict" });
  expect((await store.getMatch(secondMatch.id))?.status).toBe("pending");
});

test("PATCH成功時は更新後の照合結果と問い合わせを返す", async () => {
  const store = new MemoryStore();
  const app = createApp(async () => contextFor(store));
  const { firstItem, inquiry, firstMatch } = await seedDecisionScenario(store);

  const response = await patchMatch(app, firstMatch.id, { status: "confirmed" });
  const body = (await response.json()) as { match: Match; inquiry: Inquiry };

  expect(response.status).toBe(200);
  expect(Object.keys(body).sort()).toEqual(["inquiry", "match"]);
  expect(body.match).toMatchObject({ id: firstMatch.id, status: "confirmed" });
  expect(body.inquiry).toMatchObject({
    id: inquiry.id,
    status: "resolved",
    matched_item_id: firstItem.id,
  });
});

test("D1判断後のベクトル同期失敗は適用済み503とし、同じ判断で修復できる", async () => {
  const fixture = storeFactories[1][1]();
  try {
    const { store, inquiriesVectorize } = fixture;
    const app = createApp(async () => contextFor(store));
    const { firstItem, inquiry, firstMatch } = await seedDecisionScenario(store);
    inquiriesVectorize!.vectors.set(inquiry.id, {
      id: inquiry.id,
      values: [0.25, 0.75],
      metadata: { category: "財布", status: "matched" },
    });
    inquiriesVectorize!.failUpserts = 3;

    const failed = await patchMatch(app, firstMatch.id, { status: "confirmed" });
    expect(failed.status).toBe(503);
    expect(await failed.json()).toEqual({
      error: "vector_metadata_sync_failed",
      applied: true,
    });
    expect(await store.getMatch(firstMatch.id)).toMatchObject({ status: "confirmed" });
    expect(await store.getInquiry(inquiry.id)).toMatchObject({
      status: "resolved",
      matched_item_id: firstItem.id,
    });

    const retried = await patchMatch(app, firstMatch.id, { status: "confirmed" });
    expect(retried.status).toBe(200);
    expect(inquiriesVectorize!.upsertCalls).toBe(4);
    expect(inquiriesVectorize!.vectors.get(inquiry.id)?.metadata).toEqual({
      category: "財布",
      status: "resolved",
    });
  } finally {
    fixture.close();
  }
});
