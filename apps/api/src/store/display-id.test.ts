import { describe, expect, test } from "bun:test";
import { MemoryStore } from "./memory.ts";
import { DuplicateDisplayIdError, mapDisplayIdWriteError } from "./errors.ts";

describe("管理番号の一意性", () => {
  test("MemoryStoreは同じ管理番号の同時作成を1件だけ許可する", async () => {
    const store = new MemoryStore();
    const results = await Promise.allSettled([
      store.createItem({ display_id: "FD-0001" }),
      store.createItem({ display_id: "FD-0001" }),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected).toMatchObject({ reason: expect.any(DuplicateDisplayIdError) });
  });

  test("MemoryStoreは更新競合を拒否して既存値を維持する", async () => {
    const store = new MemoryStore();
    const first = await store.createItem({ display_id: "FD-0001" });
    const second = await store.createItem({ display_id: "FD-0002" });

    await expect(
      store.updateItem(second.id, { display_id: first.display_id }),
    ).rejects.toBeInstanceOf(DuplicateDisplayIdError);
    expect((await store.getItem(second.id))?.display_id).toBe("FD-0002");
  });

  test("空値の重複と大文字小文字や空白が異なる値を許可する", async () => {
    const store = new MemoryStore();

    await store.createItem({ display_id: "" });
    await store.createItem({ display_id: "" });
    await store.createItem({ display_id: "FD-0001" });
    await store.createItem({ display_id: "fd-0001" });
    await store.createItem({ display_id: " FD-0001 " });

    expect(await store.listItems({})).toHaveLength(5);
  });

  test("D1の管理番号一意制約だけを共通エラーへ変換する", () => {
    const duplicate = new Error(
      "D1_ERROR: UNIQUE constraint failed: items.display_id: SQLITE_CONSTRAINT",
    );
    const unrelated = new Error("D1_ERROR: database unavailable");

    expect(mapDisplayIdWriteError(duplicate)).toBeInstanceOf(DuplicateDisplayIdError);
    expect(mapDisplayIdWriteError(unrelated)).toBe(unrelated);
  });
});
