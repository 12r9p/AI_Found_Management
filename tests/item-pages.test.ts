import { expect, test } from "bun:test";
import type { ItemPage } from "../apps/web/lib/api";
import { fetchAllItems } from "../apps/web/lib/item-pages";
import type { Item } from "../apps/web/lib/types";

test("印刷用の全ページ取得は1,001件を終端まで集めて進捗を通知する", async () => {
  const source = Array.from({ length: 1_001 }, (_, index) => makeItem(`item-${index}`));
  const calls: Record<string, string>[] = [];
  const progress: number[] = [];
  const loadPage = async (query: Record<string, string>): Promise<ItemPage> => {
    calls.push(query);
    const offset = query.cursor ? Number(query.cursor) : 0;
    const limit = Number(query.limit);
    const items = source.slice(offset, offset + limit);
    const nextOffset = offset + items.length;
    return {
      items,
      nextCursor: nextOffset < source.length ? String(nextOffset) : null,
    };
  };

  const items = await fetchAllItems(
    loadPage,
    { category: "傘", cursor: "破棄される値", limit: "1" },
    (count) => progress.push(count),
  );

  expect(items).toHaveLength(1_001);
  expect(calls).toHaveLength(6);
  expect(calls.every((query) => query.category === "傘" && query.limit === "200")).toBe(true);
  expect(calls[0].cursor).toBeUndefined();
  expect(calls[1].cursor).toBe("200");
  expect(progress).toEqual([200, 400, 600, 800, 1_000, 1_001]);
});

function makeItem(id: string): Item {
  return {
    id,
    display_id: id,
    status: "stored",
    category: "傘",
    color: "",
    brand: "",
    found_location: "",
    found_at: null,
    map_key: "",
    found_x: null,
    found_y: null,
    image_keys: [],
    ai_description: "",
    tags: [],
    notes: "",
    ai_status: "ready",
    created_at: "2026-08-01T09:00:00.000Z",
    updated_at: "2026-08-01T09:00:00.000Z",
  };
}
