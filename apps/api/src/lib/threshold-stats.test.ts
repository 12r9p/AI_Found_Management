import { test, expect } from "bun:test";
import { MemoryStore } from "../store/memory.ts";
import {
  calculateThresholdStats,
  getEffectiveThreshold,
  MATCH_THRESHOLD_SETTING_KEY,
} from "./threshold-stats.ts";

test("getEffectiveThreshold: 未設定時はデフォルト値を返す", async () => {
  const store = new MemoryStore();
  const threshold = await getEffectiveThreshold(store, 0.5);
  expect(threshold).toBe(0.5);
});

test("getEffectiveThreshold: 設定値が存在すればそれを数値で返す", async () => {
  const store = new MemoryStore();
  await store.setSetting(MATCH_THRESHOLD_SETTING_KEY, "0.45");
  const threshold = await getEffectiveThreshold(store, 0.5);
  expect(threshold).toBe(0.45);
});

test("calculateThresholdStats: 確定データが5件未満の場合は insufficient_data を返す", async () => {
  const store = new MemoryStore();
  // 2件だけ作成
  await store.createMatch({
    item_id: "item-1",
    inquiry_id: "inq-1",
    score: 0.85,
    status: "confirmed",
    direction: "item_to_inquiry",
  });
  await store.createMatch({
    item_id: "item-2",
    inquiry_id: "inq-2",
    score: 0.75,
    status: "confirmed",
    direction: "item_to_inquiry",
  });

  const stats = await calculateThresholdStats(store, 0.5);
  expect(stats.status).toBe("insufficient_data");
  expect(stats.sampleCount).toBe(2);
  expect(stats.recommendedThreshold).toBe(0.5);
  expect(stats.distribution).toBeNull();
});

test("calculateThresholdStats: 確定データが5件以上の場合は p5 ベースで推奨しきい値を計算する", async () => {
  const store = new MemoryStore();
  const scores = [0.42, 0.55, 0.68, 0.72, 0.81, 0.89, 0.95];
  for (let i = 0; i < scores.length; i++) {
    await store.createMatch({
      item_id: `item-${i}`,
      inquiry_id: `inq-${i}`,
      score: scores[i],
      status: "confirmed",
      direction: "item_to_inquiry",
    });
  }

  const stats = await calculateThresholdStats(store, 0.5);
  expect(stats.status).toBe("sufficient_data");
  expect(stats.sampleCount).toBe(7);
  expect(stats.distribution).not.toBeNull();
  expect(stats.distribution?.min).toBe(0.42);
  expect(stats.distribution?.max).toBe(0.95);
  expect(stats.distribution?.p5).toBe(0.42);
  expect(stats.recommendedThreshold).toBe(0.42);
});
