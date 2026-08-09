import { expect, test } from "bun:test";
import type { AIProvider } from "./ai/provider.ts";
import { createApp } from "./app.ts";
import { resolveConfig } from "./config.ts";
import type { AppContext } from "./context.ts";
import { setEnv } from "./env-holder.ts";
import type { ImageStorage } from "./storage/images.ts";
import { MemoryStore } from "./store/memory.ts";

const images: ImageStorage = {
  async put() {},
  async get() {
    return null;
  },
  async delete() {},
};

function searchContext(store: MemoryStore, ai: AIProvider): AppContext {
  return { cfg: resolveConfig({}), store, ai, images };
}

function searchRequest(q: string) {
  return new Request("http://api.example/api/search", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ q, status: "stored" }),
  });
}

test("APIは管理番号の作成競合を409で返す", async () => {
  setEnv({});
  const app = createApp();
  const displayId = `TEST-${crypto.randomUUID()}`;
  const body = JSON.stringify({
    display_id: displayId,
    image_keys: ["test-key"],
    storage_location: "本部テント・棚A",
  });

  const first = await app.handle(
    new Request("http://api.example/api/items", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    }),
  );
  const duplicate = await app.handle(
    new Request("http://api.example/api/items", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    }),
  );

  expect(first.status).toBe(200);
  expect(duplicate.status).toBe(409);
  expect(await duplicate.json()).toEqual({ error: "duplicate_display_id" });
});

test("APIは管理番号の更新競合を409で返す", async () => {
  setEnv({});
  const app = createApp();
  const firstDisplayId = `TEST-${crypto.randomUUID()}`;
  const secondDisplayId = `TEST-${crypto.randomUUID()}`;
  const create = async (displayId: string) => {
    const response = await app.handle(
      new Request("http://api.example/api/items", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          display_id: displayId,
          image_keys: ["test-key"],
          storage_location: "本部テント・棚A",
        }),
      }),
    );
    return (await response.json()) as { item: { id: string } };
  };
  await create(firstDisplayId);
  const second = await create(secondDisplayId);

  const duplicate = await app.handle(
    new Request(`http://api.example/api/items/${second.item.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ display_id: firstDisplayId }),
    }),
  );

  expect(duplicate.status).toBe(409);
  expect(await duplicate.json()).toEqual({ error: "duplicate_display_id" });
});

test("APIは画像なしの登録を400で拒否する", async () => {
  setEnv({});
  const app = createApp();

  const response = await app.handle(
    new Request("http://api.example/api/items", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ display_id: `TEST-${crypto.randomUUID()}`, image_keys: [] }),
    }),
  );

  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: "image_required" });
});

test("APIは保管場所なしの登録を400で拒否し、入力値を保持する", async () => {
  setEnv({});
  const app = createApp();

  const missing = await app.handle(
    new Request("http://api.example/api/items", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ image_keys: ["test-key"] }),
    }),
  );
  expect(missing.status).toBe(400);
  expect(await missing.json()).toEqual({ error: "storage_location_required" });

  const created = await app.handle(
    new Request("http://api.example/api/items", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        display_id: `TEST-${crypto.randomUUID()}`,
        image_keys: ["test-key"],
        storage_location: "  本部テント・棚A  ",
      }),
    }),
  );
  expect(created.status).toBe(200);
  const { item } = (await created.json()) as { item: { id: string; storage_location: string } };
  expect(item.storage_location).toBe("本部テント・棚A");

  const cleared = await app.handle(
    new Request(`http://api.example/api/items/${item.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ storage_location: " " }),
    }),
  );
  expect(cleared.status).toBe(400);
  expect(await cleared.json()).toEqual({ error: "storage_location_required" });
});

test("特徴検索欄の管理番号を完全一致と部分一致でAIを使わず検索する", async () => {
  const store = new MemoryStore();
  const target = await store.createItem({
    display_id: "FD-2026-0001",
    status: "stored",
    category: "傘",
  });
  await store.createItem({ display_id: "FD-2026-0002", status: "stored", category: "財布" });
  let embedCalls = 0;
  const ai: AIProvider = {
    name: "display-id-search-test",
    async describeImages() {
      throw new Error("not used");
    },
    async embed() {
      embedCalls++;
      throw new Error("管理番号検索では呼ばれない");
    },
    async chat() {
      throw new Error("管理番号検索では呼ばれない");
    },
  };
  const app = createApp(async () => searchContext(store, ai));

  for (const query of ["FD-2026-0001", "0001"]) {
    const response = await app.handle(searchRequest(query));
    const body = (await response.json()) as { items: { id: string; score: number | null }[] };
    expect(response.status).toBe(200);
    expect(body.items).toEqual([expect.objectContaining({ id: target.id, score: null })]);
  }
  expect(embedCalls).toBe(0);
});

test("管理番号に一致しない文章は従来の特徴ベクトル検索へ流す", async () => {
  const store = new MemoryStore();
  const target = await store.createItem({
    display_id: "FD-2026-0001",
    status: "stored",
    category: "傘",
    color: "紺",
    ai_description: "紺色の折りたたみ傘",
    embedding: [1, 0],
  });
  let embedCalls = 0;
  const ai: AIProvider = {
    name: "feature-search-test",
    async describeImages() {
      throw new Error("not used");
    },
    async embed() {
      embedCalls++;
      return [1, 0];
    },
    async chat() {
      return '{"category":"","color":""}';
    },
  };
  const app = createApp(async () => searchContext(store, ai));

  const response = await app.handle(searchRequest("紺色の折りたたみ傘"));
  const body = (await response.json()) as { items: { id: string }[] };

  expect(response.status).toBe(200);
  expect(body.items.map((item) => item.id)).toEqual([target.id]);
  expect(embedCalls).toBe(1);
});
