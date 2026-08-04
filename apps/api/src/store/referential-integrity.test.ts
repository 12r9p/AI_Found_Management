import { Database, type SQLQueryBindings } from "bun:sqlite";
import { describe, expect, spyOn, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { AIProvider } from "../ai/provider.ts";
import { createApp } from "../app.ts";
import { resolveConfig } from "../config.ts";
import type { AppContext } from "../context.ts";
import type { ImageStorage } from "../storage/images.ts";
import { D1VectorizeStore } from "./d1.ts";
import { MemoryStore } from "./memory.ts";
import type { Store } from "./store.ts";

const migrationsDirectory = new URL("../../migrations/", import.meta.url);

function migration(name: string): string {
  return readFileSync(new URL(name, migrationsDirectory), "utf8");
}

function createLegacyDatabase(): Database {
  const sqlite = new Database(":memory:");
  sqlite.exec(migration("0001_init.sql"));
  sqlite.exec(migration("0002_ai_status_and_counters.sql"));
  sqlite.exec(migration("0003_drop_storage_location.sql"));
  return sqlite;
}

function applyReferentialIntegrityMigration(sqlite: Database): void {
  sqlite.exec("PRAGMA foreign_keys = ON");
  sqlite.transaction(() => sqlite.exec(migration("0005_referential_integrity.sql"))).immediate();
}

function insertItem(sqlite: Database, id: string): void {
  sqlite
    .prepare(
      `INSERT INTO items
       (id, display_id, status, category, color, brand, found_location, found_at,
        map_key, found_x, found_y, image_keys, ai_description, tags, notes,
        ai_status, created_at, updated_at)
       VALUES (?, ?, 'stored', '財布', '黒', '', '', NULL, '', NULL, NULL,
               '[]', '', '[]', '', 'ready', ?, ?)`,
    )
    .run(id, id, "2026-08-01T00:00:00.000Z", "2026-08-01T00:00:00.000Z");
}

function insertInquiry(
  sqlite: Database,
  id: string,
  matchedItemId: string | null = null,
  status = "matched",
): void {
  sqlite
    .prepare(
      `INSERT INTO inquiries
       (id, status, description, category, color, ai_description, tags,
        reference_no, notes, matched_item_id, created_at, updated_at)
       VALUES (?, ?, '', '財布', '黒', '', '[]', '', '', ?, ?, ?)`,
    )
    .run(id, status, matchedItemId, "2026-08-01T00:00:00.000Z", "2026-08-01T00:00:00.000Z");
}

function insertMatch(
  sqlite: Database,
  id: string,
  itemId: string,
  inquiryId: string,
  status = "pending",
): void {
  sqlite
    .prepare(
      `INSERT INTO matches
       (id, item_id, inquiry_id, score, status, direction, created_at)
       VALUES (?, ?, ?, 0.9, ?, 'item_to_inquiry', ?)`,
    )
    .run(id, itemId, inquiryId, status, "2026-08-01T00:00:00.000Z");
}

function insertNotification(
  sqlite: Database,
  id: string,
  itemId: string | null,
  inquiryId: string | null,
  matchId: string | null,
): void {
  sqlite
    .prepare(
      `INSERT INTO notifications
       (id, type, title, body, ref_item_id, ref_inquiry_id, ref_match_id, read, created_at)
       VALUES (?, 'match_found', '', '', ?, ?, ?, 0, ?)`,
    )
    .run(id, itemId, inquiryId, matchId, "2026-08-01T00:00:00.000Z");
}

test("新規スキーマに参照動作と必要な索引を追加し外部キー検査を通す", () => {
  const sqlite = createLegacyDatabase();
  try {
    applyReferentialIntegrityMigration(sqlite);

    expect(sqlite.query("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(
      sqlite
        .query("PRAGMA foreign_key_list('inquiries')")
        .all()
        .map((row: any) => [row.from, row.table, row.on_delete]),
    ).toContainEqual(["matched_item_id", "items", "SET NULL"]);
    expect(
      sqlite
        .query("PRAGMA foreign_key_list('matches')")
        .all()
        .map((row: any) => [row.from, row.table, row.on_delete]),
    ).toEqual(
      expect.arrayContaining([
        ["item_id", "items", "CASCADE"],
        ["inquiry_id", "inquiries", "CASCADE"],
      ]),
    );
    expect(
      sqlite
        .query("PRAGMA foreign_key_list('notifications')")
        .all()
        .map((row: any) => [row.from, row.table, row.on_delete]),
    ).toEqual(
      expect.arrayContaining([
        ["ref_item_id", "items", "SET NULL"],
        ["ref_inquiry_id", "inquiries", "SET NULL"],
        ["ref_match_id", "matches", "SET NULL"],
      ]),
    );
    expect(
      sqlite
        .query("PRAGMA index_list('matches')")
        .all()
        .map((row: any) => [row.name, row.unique]),
    ).toEqual(
      expect.arrayContaining([
        ["matches_item_id_idx", 0],
        ["matches_inquiry_id_idx", 0],
        [expect.stringContaining("sqlite_autoindex_matches"), 1],
      ]),
    );
    expect(
      sqlite
        .query("PRAGMA index_list('inquiries')")
        .all()
        .map((row: any) => row.name),
    ).toContain("inquiries_matched_item_id_idx");
  } finally {
    sqlite.close();
  }
});

test("既存スキーマの孤児照合を除去し参照先がない通知と確定物品をNULL化する", () => {
  const sqlite = createLegacyDatabase();
  try {
    insertItem(sqlite, "item-valid");
    insertInquiry(sqlite, "inquiry-valid", "item-missing");
    insertMatch(sqlite, "match-valid", "item-valid", "inquiry-valid");
    insertMatch(sqlite, "match-orphan-item", "item-missing", "inquiry-valid");
    insertMatch(sqlite, "match-orphan-inquiry", "item-valid", "inquiry-missing");
    insertNotification(
      sqlite,
      "notification-orphan",
      "item-missing",
      "inquiry-missing",
      "match-orphan-item",
    );

    applyReferentialIntegrityMigration(sqlite);

    expect(sqlite.query("SELECT id FROM matches ORDER BY id").all()).toEqual([
      { id: "match-valid" },
    ]);
    expect(
      sqlite.query("SELECT matched_item_id FROM inquiries WHERE id='inquiry-valid'").get(),
    ).toEqual({ matched_item_id: null });
    expect(
      sqlite
        .query(
          `SELECT ref_item_id, ref_inquiry_id, ref_match_id
           FROM notifications WHERE id='notification-orphan'`,
        )
        .get(),
    ).toEqual({ ref_item_id: null, ref_inquiry_id: null, ref_match_id: null });
    expect(sqlite.query("PRAGMA foreign_key_check").all()).toEqual([]);
  } finally {
    sqlite.close();
  }
});

test("孤児照合の除去後に残存する照合から問い合わせ状態を再計算する", () => {
  const sqlite = createLegacyDatabase();
  try {
    insertItem(sqlite, "item-valid");
    insertInquiry(sqlite, "inquiry-pending", "item-missing");
    insertMatch(sqlite, "match-orphan-confirmed", "item-missing", "inquiry-pending", "confirmed");
    insertMatch(sqlite, "match-valid-pending", "item-valid", "inquiry-pending");
    insertInquiry(sqlite, "inquiry-open", "item-missing");
    insertMatch(sqlite, "match-only-orphan", "item-missing", "inquiry-open", "confirmed");
    insertInquiry(sqlite, "inquiry-closed", null, "closed");
    insertInquiry(sqlite, "inquiry-closed-affected", "item-missing", "closed");
    insertMatch(
      sqlite,
      "match-closed-orphan",
      "item-missing",
      "inquiry-closed-affected",
      "confirmed",
    );

    applyReferentialIntegrityMigration(sqlite);

    expect(
      sqlite
        .query(
          `SELECT id, status, matched_item_id
           FROM inquiries
           WHERE id IN (
             'inquiry-closed',
             'inquiry-closed-affected',
             'inquiry-open',
             'inquiry-pending'
           )
           ORDER BY id`,
        )
        .all(),
    ).toEqual([
      { id: "inquiry-closed", status: "closed", matched_item_id: null },
      { id: "inquiry-closed-affected", status: "closed", matched_item_id: null },
      { id: "inquiry-open", status: "open", matched_item_id: null },
      { id: "inquiry-pending", status: "matched", matched_item_id: null },
    ]);
    expect(sqlite.query("PRAGMA foreign_key_check").all()).toEqual([]);
  } finally {
    sqlite.close();
  }
});

test("物品と問い合わせの削除時に照合を連鎖削除し通知参照をNULL化する", () => {
  const sqlite = createLegacyDatabase();
  try {
    applyReferentialIntegrityMigration(sqlite);
    insertItem(sqlite, "item-1");
    insertInquiry(sqlite, "inquiry-1", "item-1");
    insertMatch(sqlite, "match-1", "item-1", "inquiry-1");
    insertNotification(sqlite, "notification-1", "item-1", "inquiry-1", "match-1");

    sqlite.prepare("DELETE FROM items WHERE id=?").run("item-1");

    expect(sqlite.query("SELECT id FROM matches").all()).toEqual([]);
    expect(
      sqlite.query("SELECT matched_item_id FROM inquiries WHERE id='inquiry-1'").get(),
    ).toEqual({ matched_item_id: null });
    expect(
      sqlite
        .query(
          `SELECT ref_item_id, ref_inquiry_id, ref_match_id
           FROM notifications WHERE id='notification-1'`,
        )
        .get(),
    ).toEqual({ ref_item_id: null, ref_inquiry_id: "inquiry-1", ref_match_id: null });

    insertItem(sqlite, "item-2");
    insertMatch(sqlite, "match-2", "item-2", "inquiry-1");
    insertNotification(sqlite, "notification-2", "item-2", "inquiry-1", "match-2");
    sqlite.prepare("DELETE FROM inquiries WHERE id=?").run("inquiry-1");

    expect(sqlite.query("SELECT id FROM matches").all()).toEqual([]);
    expect(
      sqlite
        .query(
          `SELECT ref_item_id, ref_inquiry_id, ref_match_id
           FROM notifications WHERE id='notification-2'`,
        )
        .get(),
    ).toEqual({ ref_item_id: "item-2", ref_inquiry_id: null, ref_match_id: null });
    expect(sqlite.query("PRAGMA foreign_key_check").all()).toEqual([]);
  } finally {
    sqlite.close();
  }
});

class SqliteD1 implements Pick<D1Database, "prepare" | "batch"> {
  readonly sqlite = createLegacyDatabase();

  constructor() {
    applyReferentialIntegrityMigration(this.sqlite);
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
    return d1Result(this.statement().all(...this.bindings()) as T[]);
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

class RecordingVectorize implements Pick<
  Vectorize,
  "query" | "upsert" | "deleteByIds" | "getByIds"
> {
  readonly vectors = new Map<string, VectorizeVector>();
  readonly deletedIds: string[][] = [];
  readonly upserts: VectorizeVector[][] = [];
  failDeletes = 0;

  async query(): Promise<VectorizeMatches> {
    return { count: 0, matches: [] };
  }

  async upsert(vectors: VectorizeVector[]): Promise<VectorizeAsyncMutation> {
    this.upserts.push(vectors.map(copyVector));
    for (const vector of vectors) this.vectors.set(vector.id, copyVector(vector));
    return { mutationId: `upsert-${this.upserts.length}` };
  }

  async deleteByIds(ids: string[]): Promise<VectorizeAsyncMutation> {
    this.deletedIds.push([...ids]);
    if (this.failDeletes > 0) {
      this.failDeletes--;
      throw new Error("Vectorize削除失敗");
    }
    for (const id of ids) this.vectors.delete(id);
    return { mutationId: `delete-${this.deletedIds.length}` };
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

type StoreFixture = {
  store: Store;
  sqlite?: SqliteD1;
  itemsVectorize?: RecordingVectorize;
  inquiriesVectorize?: RecordingVectorize;
  close(): void;
};

const storeFactories: [string, () => StoreFixture][] = [
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
      const sqlite = new SqliteD1();
      const itemsVectorize = new RecordingVectorize();
      const inquiriesVectorize = new RecordingVectorize();
      return {
        store: new D1VectorizeStore(sqlite, itemsVectorize, inquiriesVectorize),
        sqlite,
        itemsVectorize,
        inquiriesVectorize,
        close: () => sqlite.close(),
      };
    },
  ],
];

async function seedDeletionScenario(store: Store) {
  const targetItem = await store.createItem({ display_id: "FD-target" });
  const confirmedItem = await store.createItem({ display_id: "FD-confirmed" });
  const pendingItem = await store.createItem({ display_id: "FD-pending" });

  const inquiryWithRemainingConfirmedMatch = await store.createInquiry({
    status: "matched",
    matched_item_id: targetItem.id,
  });
  const targetPendingMatch = await store.createMatch({
    item_id: targetItem.id,
    inquiry_id: inquiryWithRemainingConfirmedMatch.id,
    score: 0.8,
    status: "pending",
    direction: "item_to_inquiry",
  });
  await store.createMatch({
    item_id: confirmedItem.id,
    inquiry_id: inquiryWithRemainingConfirmedMatch.id,
    score: 0.9,
    status: "confirmed",
    direction: "item_to_inquiry",
  });

  const inquiryWithRemainingPendingMatch = await store.createInquiry({
    status: "resolved",
    matched_item_id: targetItem.id,
  });
  const targetConfirmedMatch = await store.createMatch({
    item_id: targetItem.id,
    inquiry_id: inquiryWithRemainingPendingMatch.id,
    score: 0.9,
    status: "confirmed",
    direction: "item_to_inquiry",
  });
  const remainingPendingMatch = await store.createMatch({
    item_id: pendingItem.id,
    inquiry_id: inquiryWithRemainingPendingMatch.id,
    score: 0.7,
    status: "pending",
    direction: "item_to_inquiry",
  });

  const openInquiry = await store.createInquiry({ status: "matched" });
  await store.createMatch({
    item_id: targetItem.id,
    inquiry_id: openInquiry.id,
    score: 0.6,
    status: "pending",
    direction: "item_to_inquiry",
  });
  const directReferenceInquiry = await store.createInquiry({
    status: "resolved",
    matched_item_id: targetItem.id,
  });

  const notification = await store.createNotification({
    type: "match_found",
    title: "照合候補",
    body: "確認してください",
    ref_item_id: targetItem.id,
    ref_inquiry_id: inquiryWithRemainingConfirmedMatch.id,
    ref_match_id: targetPendingMatch.id,
  });

  return {
    targetItem,
    confirmedItem,
    pendingItem,
    inquiryWithRemainingConfirmedMatch,
    inquiryWithRemainingPendingMatch,
    targetConfirmedMatch,
    remainingPendingMatch,
    openInquiry,
    directReferenceInquiry,
    notification,
  };
}

for (const [storeName, createStore] of storeFactories) {
  describe(storeName, () => {
    test("物品削除で照合と通知参照を整理し問い合わせ状態を残存候補から再計算する", async () => {
      const fixture = createStore();
      try {
        const scenario = await seedDeletionScenario(fixture.store);

        expect(await fixture.store.deleteItem(scenario.targetItem.id)).toBe(true);
        expect(await fixture.store.deleteItem(scenario.targetItem.id)).toBe(false);
        expect(await fixture.store.getItem(scenario.targetItem.id)).toBeNull();
        expect(
          (await fixture.store.listMatches()).some(
            (match) => match.item_id === scenario.targetItem.id,
          ),
        ).toBe(false);
        expect(
          await fixture.store.getInquiry(scenario.inquiryWithRemainingConfirmedMatch.id),
        ).toMatchObject({
          status: "resolved",
          matched_item_id: scenario.confirmedItem.id,
        });
        expect(
          await fixture.store.getInquiry(scenario.inquiryWithRemainingPendingMatch.id),
        ).toMatchObject({
          status: "matched",
          matched_item_id: null,
        });
        expect(await fixture.store.getInquiry(scenario.openInquiry.id)).toMatchObject({
          status: "open",
          matched_item_id: null,
        });
        expect(await fixture.store.getInquiry(scenario.directReferenceInquiry.id)).toMatchObject({
          status: "open",
          matched_item_id: null,
        });
        expect(
          (await fixture.store.listNotifications()).find(
            (notification) => notification.id === scenario.notification.id,
          ),
        ).toMatchObject({
          ref_item_id: null,
          ref_inquiry_id: scenario.inquiryWithRemainingConfirmedMatch.id,
          ref_match_id: null,
        });

        const inquiryNotification = await fixture.store.createNotification({
          type: "match_found",
          title: "残存候補",
          body: "確認してください",
          ref_item_id: scenario.pendingItem.id,
          ref_inquiry_id: scenario.inquiryWithRemainingPendingMatch.id,
          ref_match_id: scenario.remainingPendingMatch.id,
        });
        expect(
          await fixture.store.deleteInquiry(scenario.inquiryWithRemainingPendingMatch.id),
        ).toBe(true);
        expect(
          await fixture.store.deleteInquiry(scenario.inquiryWithRemainingPendingMatch.id),
        ).toBe(false);
        expect(
          await fixture.store.getInquiry(scenario.inquiryWithRemainingPendingMatch.id),
        ).toBeNull();
        expect(await fixture.store.getMatch(scenario.remainingPendingMatch.id)).toBeNull();
        expect(
          (await fixture.store.listNotifications()).find(
            (notification) => notification.id === inquiryNotification.id,
          ),
        ).toMatchObject({
          ref_item_id: scenario.pendingItem.id,
          ref_inquiry_id: null,
          ref_match_id: null,
        });
      } finally {
        fixture.close();
      }
    });

    test("closed問い合わせの物品削除後もstatusをclosedに維持する", async () => {
      const fixture = createStore();
      try {
        const item = await fixture.store.createItem({ display_id: "FD-closed" });
        const inquiry = await fixture.store.createInquiry({
          status: "closed",
          matched_item_id: item.id,
        });
        await fixture.store.createMatch({
          item_id: item.id,
          inquiry_id: inquiry.id,
          score: 0.8,
          status: "pending",
          direction: "item_to_inquiry",
        });

        expect(await fixture.store.deleteItem(item.id)).toBe(true);
        expect(await fixture.store.getInquiry(inquiry.id)).toMatchObject({
          status: "closed",
          matched_item_id: null,
        });
      } finally {
        fixture.close();
      }
    });
  });
}

test("D1の物品削除が失敗すると同じバッチの問い合わせ再計算も取り消す", async () => {
  const fixture = storeFactories[1][1]();
  try {
    const scenario = await seedDeletionScenario(fixture.store);
    fixture.sqlite!.sqlite.exec(`
      CREATE TRIGGER prevent_item_deletion
      BEFORE DELETE ON items
      BEGIN
        SELECT RAISE(ABORT, '物品削除を拒否');
      END;
    `);

    await expect(fixture.store.deleteItem(scenario.targetItem.id)).rejects.toThrow(
      "物品削除を拒否",
    );
    expect(await fixture.store.getItem(scenario.targetItem.id)).not.toBeNull();
    expect(
      await fixture.store.getInquiry(scenario.inquiryWithRemainingPendingMatch.id),
    ).toMatchObject({
      status: "resolved",
      matched_item_id: scenario.targetItem.id,
    });
    expect(await fixture.store.getMatch(scenario.targetConfirmedMatch.id)).not.toBeNull();
  } finally {
    fixture.close();
  }
});

test("Vectorize削除に失敗してもD1削除を維持し残りの問い合わせ同期を試す", async () => {
  const fixture = storeFactories[1][1]();
  const errorSpy = spyOn(console, "error").mockImplementation(() => {});
  try {
    const scenario = await seedDeletionScenario(fixture.store);
    fixture.itemsVectorize!.failDeletes = 1;
    fixture.inquiriesVectorize!.vectors.set(scenario.inquiryWithRemainingPendingMatch.id, {
      id: scenario.inquiryWithRemainingPendingMatch.id,
      values: [0.25, 0.75],
      metadata: { category: "", status: "resolved" },
    });

    expect(await fixture.store.deleteItem(scenario.targetItem.id)).toBe(true);

    expect(await fixture.store.getItem(scenario.targetItem.id)).toBeNull();
    expect(fixture.itemsVectorize!.deletedIds).toContainEqual([scenario.targetItem.id]);
    expect(fixture.inquiriesVectorize!.upserts.at(-1)?.[0]?.metadata).toEqual({
      category: "",
      status: "matched",
    });
    expect(
      errorSpy.mock.calls.some(([message]) => {
        const log = JSON.parse(String(message));
        return (
          log.event === "deletion_cleanup_failed" &&
          log.resource === "items_vectorize" &&
          log.applied === true
        );
      }),
    ).toBe(true);

    fixture.inquiriesVectorize!.failDeletes = 1;
    expect(await fixture.store.deleteInquiry(scenario.openInquiry.id)).toBe(true);
    expect(await fixture.store.getInquiry(scenario.openInquiry.id)).toBeNull();
    expect(
      errorSpy.mock.calls.some(([message]) => {
        const log = JSON.parse(String(message));
        return (
          log.event === "deletion_cleanup_failed" &&
          log.resource === "inquiries_vectorize" &&
          log.entityId === scenario.openInquiry.id
        );
      }),
    ).toBe(true);
  } finally {
    errorSpy.mockRestore();
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

test("R2画像削除に失敗しても物品削除を維持し全画像の後処理を試す", async () => {
  const store = new MemoryStore();
  const item = await store.createItem({
    display_id: "FD-images",
    image_keys: ["first.jpg", "second.jpg"],
  });
  const deletedKeys: string[] = [];
  const images: ImageStorage = {
    async put() {},
    async get() {
      return null;
    },
    async delete(key) {
      deletedKeys.push(key);
      throw new Error(`${key}の削除失敗`);
    },
  };
  const context: AppContext = { cfg: resolveConfig({}), store, ai, images };
  const errorSpy = spyOn(console, "error").mockImplementation(() => {});
  const app = createApp(async () => context);

  const response = await app.fetch(
    new Request(`http://localhost/api/items/${item.id}`, { method: "DELETE" }),
  );

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ deleted: true });
  expect(await store.getItem(item.id)).toBeNull();
  expect(deletedKeys).toEqual(["first.jpg", "second.jpg"]);
  expect(
    errorSpy.mock.calls
      .map(([message]) => JSON.parse(String(message)))
      .filter((log) => log.event === "deletion_cleanup_failed")
      .map((log) => log.objectKey),
  ).toEqual(["first.jpg", "second.jpg"]);
  errorSpy.mockRestore();
});
