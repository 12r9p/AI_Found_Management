import { test, expect } from "bun:test";
import { createAIProvider } from "./provider.ts";
import { resolveConfig } from "../config.ts";

// AI_API_KEY 未設定なのでモックプロバイダになる（本テストの前提）。
const provider = createAIProvider(resolveConfig({}));

test("モックプロバイダが選ばれる（APIキー未設定）", () => {
  expect(provider.name).toBe("mock");
});

test("describeImages は 'undefined' を出力に混入させない", async () => {
  // ハッシュ値が符号付き32bit範囲を超えるケース（負値化バグ）を広く踏むため多数のseedで検証。
  for (let i = 0; i < 200; i++) {
    const url = `data:image/png;base64,seed-${i}-${"x".repeat(i)}`;
    const hint = i % 3 === 0 ? `メモ${i}` : undefined;
    const d = await provider.describeImages([{ url }], hint);
    expect(d.description).not.toMatch(/undefined/);
    expect(d.category).not.toBe("undefined");
    expect(d.color).not.toBe("undefined");
    expect(d.tags.every((t) => t !== "undefined" && t.length > 0)).toBe(true);
    expect(d.category.length).toBeGreaterThan(0);
    expect(d.color.length).toBeGreaterThan(0);
  }
});

test("describeImages は同じ入力に対して決定論的", async () => {
  const url = "data:image/png;base64,stable-seed-value";
  const a = await provider.describeImages([{ url }], "テスト");
  const b = await provider.describeImages([{ url }], "テスト");
  expect(a).toEqual(b);
});
