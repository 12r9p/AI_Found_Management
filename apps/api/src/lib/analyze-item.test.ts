import { test, expect } from "bun:test";
import { MemoryStore } from "../store/memory.ts";
import { resolveConfig } from "../config.ts";
import { runBackgroundAnalysis } from "./analyze-item.ts";
import type { AIProvider, DescribeResult } from "../ai/provider.ts";
import type { AppContext } from "../context.ts";

/** 指定回数だけ describeImages が失敗する AIProvider スタブ（リトライ挙動の検証用）。 */
function flakyProvider(failTimes: number): AIProvider {
  let calls = 0;
  return {
    name: "flaky",
    async describeImages(): Promise<DescribeResult> {
      calls++;
      if (calls <= failTimes) throw new Error("transient AI error");
      return { description: "テスト特徴文", tags: ["黒", "財布"], category: "財布", color: "黒", brand: "" };
    },
    async embed(text: string) {
      return Array.from({ length: 8 }, (_, i) => (text.length + i) % 7);
    },
    async chat() {
      return "";
    },
  };
}

const fakeImages = { get: async () => null, put: async () => {}, delete: async () => {} } as any;

test("runBackgroundAnalysis は一時的な失敗をリトライして最終的に成功する", async () => {
  const store = new MemoryStore();
  const item = await store.createItem({ status: "stored", image_keys: [], ai_status: "pending" });
  const c: AppContext = { cfg: resolveConfig({}), store, ai: flakyProvider(2), images: fakeImages };
  await runBackgroundAnalysis(c, item);
  const updated = await store.getItem(item.id);
  expect(updated?.ai_status).toBe("ready");
  expect(updated?.category).toBe("財布");
});

test("runBackgroundAnalysis はリトライを使い切ると ai_status を error にする", async () => {
  const store = new MemoryStore();
  const item = await store.createItem({ status: "stored", image_keys: [], ai_status: "pending" });
  const c: AppContext = { cfg: resolveConfig({}), store, ai: flakyProvider(99), images: fakeImages };
  await runBackgroundAnalysis(c, item);
  const updated = await store.getItem(item.id);
  expect(updated?.ai_status).toBe("error");
});
