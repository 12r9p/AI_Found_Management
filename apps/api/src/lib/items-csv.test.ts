import { expect, test } from "bun:test";
import { createApp } from "../app.ts";
import type { Env } from "../config.ts";
import { setEnv } from "../env-holder.ts";
import type { ItemListOptions, ItemPage } from "../store/item-pagination.ts";
import { MemoryStore } from "../store/memory.ts";
import type { SearchFilters } from "../types.ts";
import { createItemsCsvStream, escapeCsvCell } from "./items-csv.ts";

class CountingMemoryStore extends MemoryStore {
  listCalls = 0;

  override async listItems(filters: SearchFilters, options?: ItemListOptions): Promise<ItemPage> {
    this.listCalls++;
    return super.listItems(filters, options);
  }
}

test("CSVセルはカンマ・引用符・改行を保持したままエスケープする", () => {
  expect(escapeCsvCell('改行\n"引用",値')).toBe('"改行\n""引用"",値"');
});

test("CSVストリームは同じ作成日時の1,001件を全ページ出力してフィルターも維持する", async () => {
  const store = new CountingMemoryStore();
  const createdAt = "2026-08-01T09:00:00.000Z";
  for (let index = 0; index < 1_001; index++) {
    const item = await store.createItem({
      status: "stored",
      category: index % 2 === 0 ? "傘" : "財布",
      brand: index === 0 ? 'Acme, "Limited"' : "",
      ai_description: `特徴${index}`,
    });
    await store.updateItem(item.id, { created_at: createdAt });
  }

  const allBytes = new Uint8Array(
    await new Response(createItemsCsvStream(store, {})).arrayBuffer(),
  );
  const allText = new TextDecoder().decode(allBytes);
  const allLines = allText.trimEnd().split("\n");
  expect(allLines).toHaveLength(1_002);
  expect(allLines[0]).toBe(
    "id,status,category,color,brand,found_location,map_pin,found_at,ai_description,tags,created_at",
  );
  expect(Array.from(allBytes.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
  expect(allText).toContain('"Acme, ""Limited"""');
  expect(store.listCalls).toBe(6);

  store.listCalls = 0;
  const filteredText = await new Response(createItemsCsvStream(store, { category: "傘" })).text();
  expect(filteredText.trimEnd().split("\n")).toHaveLength(502);
  expect(filteredText).not.toContain('"財布"');
  expect(store.listCalls).toBe(3);
});

test("CSVエンドポイントはストリーム用の応答ヘッダーを返す", async () => {
  setEnv({} as Env);
  const response = await createApp().handle(new Request("http://localhost/api/export/items.csv"));

  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("text/csv; charset=utf-8");
  expect(response.headers.get("content-disposition")).toBe('attachment; filename="items.csv"');
  expect(await response.text()).toStartWith("id,status,category");
});
