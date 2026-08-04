import { describe, expect, test } from "bun:test";
import { Database, type SQLQueryBindings } from "bun:sqlite";
import { createApp } from "../app.ts";
import { setEnv } from "../env-holder.ts";
import type { Env } from "../config.ts";
import { D1VectorizeStore } from "./d1.ts";
import { MemoryStore } from "./memory.ts";
import {
  DEFAULT_ITEM_PAGE_LIMIT,
  InvalidItemCursorError,
  InvalidItemLimitError,
  MAX_ITEM_PAGE_LIMIT,
  itemCursorFromItem,
  normalizeItemPageLimit,
  parseItemCursor,
  parseItemPageLimit,
  type ItemCursorPosition,
} from "./item-pagination.ts";

const SAME_CREATED_AT = "2026-08-01T09:00:00.000Z";

describe("物品一覧カーソル", () => {
  test("作成日時とIDをそのまま読めるカーソルとして返す", () => {
    const cursor = itemCursorFromItem({ created_at: SAME_CREATED_AT, id: "item-001" });

    expect(cursor).toEqual({ createdAt: SAME_CREATED_AT, id: "item-001" });
    expect(parseItemCursor(cursor)).toEqual(cursor);
  });

  test("文字列と片方の値しかないカーソルを拒否する", () => {
    expect(() => parseItemCursor("not-a-cursor")).toThrow(InvalidItemCursorError);
    expect(() => parseItemCursor({ createdAt: SAME_CREATED_AT })).toThrow(InvalidItemCursorError);
  });

  test("非正規の日時表現を含むカーソルを拒否する", () => {
    expect(() => parseItemCursor({ createdAt: "2026-08-01", id: "item-001" })).toThrow(
      InvalidItemCursorError,
    );
  });

  test("limitの既定値と最大値を適用し不正値を拒否する", () => {
    expect(normalizeItemPageLimit()).toBe(DEFAULT_ITEM_PAGE_LIMIT);
    expect(normalizeItemPageLimit(MAX_ITEM_PAGE_LIMIT + 1)).toBe(MAX_ITEM_PAGE_LIMIT);
    expect(parseItemPageLimit("200")).toBe(200);
    expect(() => parseItemPageLimit("0")).toThrow(InvalidItemLimitError);
    expect(() => parseItemPageLimit("1.5")).toThrow(InvalidItemLimitError);
    expect(() => parseItemPageLimit(String(MAX_ITEM_PAGE_LIMIT + 1))).toThrow(
      InvalidItemLimitError,
    );
  });
});

describe("MemoryStoreの物品ページング", () => {
  test("同じ作成日時の1,001件を既定100件ずつ重複なく読み進める", async () => {
    const store = new MemoryStore();
    const expectedIds: string[] = [];
    for (let index = 0; index < 1_001; index++) {
      const item = await store.createItem({ category: "傘" });
      await store.updateItem(item.id, { created_at: SAME_CREATED_AT });
      expectedIds.push(item.id);
    }
    expectedIds.sort((a, b) => (a > b ? -1 : 1));

    const actualIds: string[] = [];
    const pageSizes: number[] = [];
    let cursor: ItemCursorPosition | undefined;
    do {
      const page = await store.listItems({}, { cursor });
      actualIds.push(...page.items.map((item) => item.id));
      pageSizes.push(page.items.length);
      cursor = page.nextCursor ?? undefined;
    } while (cursor);

    expect(pageSizes).toEqual([...Array.from({ length: 10 }, () => 100), 1]);
    expect(actualIds).toEqual(expectedIds);
    expect(new Set(actualIds).size).toBe(1_001);
  });

  test("最大200件へ丸めて次ページを返す", async () => {
    const store = new MemoryStore();
    for (let index = 0; index < 205; index++) {
      await store.createItem({ category: "傘" });
    }

    const first = await store.listItems({}, { limit: 999 });
    const terminal = await store.listItems({}, { cursor: first.nextCursor!, limit: 999 });

    expect(first.items).toHaveLength(200);
    expect(first.nextCursor).not.toBeNull();
    expect(terminal.items).toHaveLength(5);
    expect(terminal.nextCursor).toBeNull();
  });

  test("フィルターを維持したまま終端まで読み進める", async () => {
    const store = new MemoryStore();
    for (let index = 0; index < 5; index++) {
      const item = await store.createItem({ category: "傘", status: "stored" });
      await store.updateItem(item.id, { created_at: SAME_CREATED_AT });
    }
    for (let index = 0; index < 3; index++) {
      const item = await store.createItem({ category: "財布", status: "stored" });
      await store.updateItem(item.id, { created_at: SAME_CREATED_AT });
    }

    const first = await store.listItems({ category: "傘" }, { limit: 2 });
    const second = await store.listItems(
      { category: "傘" },
      { cursor: first.nextCursor!, limit: 2 },
    );
    const terminal = await store.listItems(
      { category: "傘" },
      { cursor: second.nextCursor!, limit: 2 },
    );

    expect([...first.items, ...second.items, ...terminal.items]).toHaveLength(5);
    expect(
      [...first.items, ...second.items, ...terminal.items].every((item) => item.category === "傘"),
    ).toBe(true);
    expect(terminal.items).toHaveLength(1);
    expect(terminal.nextCursor).toBeNull();
  });

  test("不正なカーソルを拒否する", async () => {
    const store = new MemoryStore();

    expect(
      store.listItems({}, { cursor: { createdAt: "2026-08-01", id: "item-001" } }),
    ).rejects.toBeInstanceOf(InvalidItemCursorError);
  });
});

describe("D1Storeの物品ページング", () => {
  test("複合作成順とフィルターをSQLite上で安定して適用する", async () => {
    const seeded = createD1Store([
      { id: "newer", createdAt: "2026-08-02T09:00:00.000Z", category: "財布" },
      { id: "same-c", createdAt: SAME_CREATED_AT, category: "傘" },
      { id: "same-b", createdAt: SAME_CREATED_AT, category: "財布" },
      { id: "same-a", createdAt: SAME_CREATED_AT, category: "傘" },
      { id: "older", createdAt: "2026-07-31T09:00:00.000Z", category: "傘" },
    ]);

    try {
      const first = await seeded.store.listItems({}, { limit: 2 });
      const second = await seeded.store.listItems({}, { cursor: first.nextCursor!, limit: 2 });
      const terminal = await seeded.store.listItems({}, { cursor: second.nextCursor!, limit: 2 });
      const filtered = await seeded.store.listItems({ category: "傘" }, { limit: 10 });

      expect([...first.items, ...second.items, ...terminal.items].map((item) => item.id)).toEqual([
        "newer",
        "same-c",
        "same-b",
        "same-a",
        "older",
      ]);
      expect(terminal.nextCursor).toBeNull();
      expect(filtered.items.map((item) => item.id)).toEqual(["same-c", "same-a", "older"]);
      expect(filtered.nextCursor).toBeNull();
    } finally {
      seeded.close();
    }
  });
});

test("GET /api/itemsは不正カーソルを400で返す", async () => {
  setEnv({} as Env);
  const response = await createApp().handle(
    new Request(`http://localhost/api/items?cursorCreatedAt=${SAME_CREATED_AT}`),
  );

  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: "invalid_cursor" });
});

test("GET /api/itemsは作成日時とIDをquery parameterで受け取る", async () => {
  setEnv({} as Env);
  const query = new URLSearchParams({
    cursorCreatedAt: SAME_CREATED_AT,
    cursorId: "item-001",
  });
  const response = await createApp().handle(
    new Request(`http://localhost/api/items?${query.toString()}`),
  );

  expect(response.status).toBe(200);
  const page = (await response.json()) as { nextCursor: unknown };
  expect(page.nextCursor === null || typeof page.nextCursor === "object").toBe(true);
});

test("GET /api/itemsは不正limitを400で返す", async () => {
  setEnv({} as Env);
  const response = await createApp().handle(new Request("http://localhost/api/items?limit=0"));

  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: "invalid_limit" });
});

test("GET /api/itemsは上限超過limitを400で返す", async () => {
  setEnv({} as Env);
  const response = await createApp().handle(
    new Request(`http://localhost/api/items?limit=${MAX_ITEM_PAGE_LIMIT + 1}`),
  );

  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: "invalid_limit" });
});

function createD1Store(rows: { id: string; createdAt: string; category: string }[]): {
  store: D1VectorizeStore;
  close: () => void;
} {
  const sqlite = new Database(":memory:");
  sqlite.exec(`
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
    )
  `);
  const insert = sqlite.prepare(
    "INSERT INTO items (id, category, created_at, updated_at) VALUES (?, ?, ?, ?)",
  );
  for (const row of rows) insert.run(row.id, row.category, row.createdAt, row.createdAt);

  const d1 = {
    prepare(sql: string) {
      let values: SQLQueryBindings[] = [];
      const statement = {
        bind(...params: SQLQueryBindings[]) {
          values = params;
          return statement;
        },
        async all() {
          return { results: sqlite.query(sql).all(...values) };
        },
      };
      return statement;
    },
  } as unknown as D1Database;

  return {
    store: new D1VectorizeStore(d1, {} as Vectorize, {} as Vectorize),
    close: () => sqlite.close(),
  };
}
