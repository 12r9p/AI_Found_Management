import { test, expect } from "bun:test";
import { MemoryStore } from "../store/memory.ts";
import { normalizeMetaOptions, readMetaOptions, getMetaLists, CATEGORIES } from "./meta.ts";

test("normalizeMetaOptions: 名前必須・重複除去・不正な色は無視", () => {
  const out = normalizeMetaOptions([
    { name: "傘", group: "身につけるもの", color: "#1e3a5f" },
    { name: "" }, // 空は捨てる
    { name: "傘" }, // 重複は先勝ち（後発は無視）
    { name: "財布", color: "not-a-color" }, // 不正な色値は無視
    { name: "  かばん  " }, // 前後空白はトリム
  ]);
  expect(out).toEqual([
    { name: "傘", group: "身につけるもの", color: "#1e3a5f" },
    { name: "財布" },
    { name: "かばん" },
  ]);
});

test("readMetaOptions: 旧形式（文字列配列）で保存されていても読める", async () => {
  const store = new MemoryStore();
  await store.setSetting("categories", JSON.stringify(["傘", "財布"]));
  const options = await readMetaOptions(store, "categories", []);
  expect(options).toEqual([{ name: "傘" }, { name: "財布" }]);
});

test("readMetaOptions: 新形式（MetaOption配列）はそのまま読める", async () => {
  const store = new MemoryStore();
  const saved = [
    { name: "黒", color: "#111111" },
    { name: "白", group: "無彩色" },
  ];
  await store.setSetting("colors", JSON.stringify(saved));
  const options = await readMetaOptions(store, "colors", []);
  expect(options).toEqual(saved);
});

test("readMetaOptions: 未設定なら既定値", async () => {
  const store = new MemoryStore();
  const fallback = [{ name: "既定" }];
  expect(await readMetaOptions(store, "categories", fallback)).toEqual(fallback);
});

test("getMetaLists: AIヒント用には名前だけの配列を返す（新形式で保存されていても）", async () => {
  const store = new MemoryStore();
  await store.setSetting(
    "categories",
    JSON.stringify([{ name: "傘" }, { name: "財布", color: "#000" }]),
  );
  const { categories } = await getMetaLists(store);
  expect(categories).toEqual(["傘", "財布"]);
  expect(CATEGORIES.length).toBeGreaterThan(0);
});
