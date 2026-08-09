import { expect, test } from "bun:test";
import type { AIProvider } from "./ai/provider.ts";
import { createApp } from "./app.ts";
import { resolveConfig } from "./config.ts";
import type { AppContext } from "./context.ts";
import type { ImageStorage } from "./storage/images.ts";
import { MemoryStore } from "./store/memory.ts";

const images: ImageStorage = {
  async put() {},
  async get() {
    return null;
  },
  async delete() {},
};

function contextFor(store: MemoryStore, ai: AIProvider): AppContext {
  return { cfg: resolveConfig({}), store, ai, images };
}

function searchRequest(body: Record<string, unknown>) {
  return new Request("http://api.example/api/search", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("カテゴリ・色・場所を特徴と合成し、登録属性が完全一致しない候補も検索する", async () => {
  const store = new MemoryStore();
  const target = await store.createItem({
    display_id: "FD-target",
    status: "stored",
    category: "その他",
    color: "紺",
    found_location: "西口",
    found_at: "2026-08-09T01:00:00.000Z",
    ai_description: "刺繍入りの布製品",
    embedding: [1, 0],
  });
  await store.createItem({
    display_id: "FD-returned",
    status: "returned",
    category: "タオル",
    color: "青",
    found_location: "東門",
    found_at: "2026-08-09T01:00:00.000Z",
    ai_description: "刺繍入りのタオル",
    embedding: [1, 0],
  });
  await store.createItem({
    display_id: "FD-old",
    status: "stored",
    category: "タオル",
    color: "青",
    found_location: "東門",
    found_at: "2026-07-01T01:00:00.000Z",
    ai_description: "刺繍入りのタオル",
    embedding: [1, 0],
  });

  let embeddedText = "";
  const ai: AIProvider = {
    name: "semantic-attribute-search-test",
    async describeImages() {
      throw new Error("not used");
    },
    async embed(text) {
      embeddedText = text;
      return [1, 0];
    },
    async chat() {
      throw new Error("検索条件の自動判定では呼ばれない");
    },
  };
  const app = createApp(async () => contextFor(store, ai));
  const response = await app.handle(
    searchRequest({
      q: "刺繍入りの布製品",
      category: "タオル",
      color: "青",
      location: "東門",
      status: "stored",
      from: "2026-08-09",
      to: "2026-08-09",
    }),
  );
  const body = (await response.json()) as { items: { id: string }[] };

  expect(response.status).toBe(200);
  expect(embeddedText).toBe("特徴: 刺繍入りの布製品\nカテゴリ: タオル\n色: 青\n拾得場所: 東門");
  expect(body.items.map((item) => item.id)).toEqual([target.id]);
});

test("特徴文なしでもカテゴリ・色・場所だけでベクトル検索する", async () => {
  const store = new MemoryStore();
  const target = await store.createItem({
    display_id: "FD-target",
    status: "stored",
    category: "その他",
    color: "紺",
    found_location: "西口",
    ai_description: "青いタオルに近い布製品",
    embedding: [1, 0],
  });
  let embeddedText = "";
  const ai: AIProvider = {
    name: "attribute-only-search-test",
    async describeImages() {
      throw new Error("not used");
    },
    async embed(text) {
      embeddedText = text;
      return [1, 0];
    },
    async chat() {
      throw new Error("not used");
    },
  };
  const app = createApp(async () => contextFor(store, ai));
  const response = await app.handle(
    searchRequest({ category: "タオル", color: "青", location: "東門" }),
  );
  const body = (await response.json()) as { items: { id: string }[] };

  expect(embeddedText).toBe("カテゴリ: タオル\n色: 青\n拾得場所: 東門");
  expect(body.items.map((item) => item.id)).toContain(target.id);
});
