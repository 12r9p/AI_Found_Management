import { expect, test } from "bun:test";
import { MemoryStore } from "../store/memory.ts";
import { normalizeFoundDateRange } from "./date-filters.ts";

test("拾得日の範囲をJSTの開始・終了境界へ変換する", () => {
  expect(normalizeFoundDateRange("2026-08-09", "2026-08-09")).toEqual({
    from: "2026-08-08T15:00:00.000Z",
    to: "2026-08-09T14:59:59.999Z",
  });
});

test("ISO日時はAPIクライアントが指定した値を維持する", () => {
  expect(normalizeFoundDateRange("2026-08-08T15:00:00.000Z", "2026-08-09T14:59:59.999Z")).toEqual({
    from: "2026-08-08T15:00:00.000Z",
    to: "2026-08-09T14:59:59.999Z",
  });
});

test("終了日当日の拾得物を含め、日付未設定と翌日の拾得物を除外する", async () => {
  const store = new MemoryStore();
  await store.createItem({ found_at: "2026-08-08T15:00:00.000Z", category: "傘" });
  await store.createItem({ found_at: "2026-08-09T14:59:59.999Z", category: "財布" });
  await store.createItem({ found_at: "2026-08-09T15:00:00.000Z", category: "鍵" });
  await store.createItem({ category: "その他" });

  const page = await store.listItems(normalizeFoundDateRange("2026-08-09", "2026-08-09"));
  expect(page.items.map((item) => item.category).sort()).toEqual(["傘", "財布"]);
});
