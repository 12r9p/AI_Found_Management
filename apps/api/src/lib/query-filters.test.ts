import { expect, test } from "bun:test";
import type { AIProvider } from "../ai/provider.ts";
import { inferQueryFilters } from "./query-filters.ts";

const categories = [
  "財布",
  "衣類",
  "アクセサリー",
  "タオル",
  "ハンカチ",
  "ハンディーファン",
  "その他",
];
const colors = ["黒", "青", "赤", "その他"];

function aiReturning(json: string): AIProvider {
  return {
    name: "filter-inference-test",
    async describeImages() {
      throw new Error("not used");
    },
    async embed() {
      return [];
    },
    async chat() {
      return json;
    },
  };
}

test("検索文のタオルと色からフィルターを自動判定する", async () => {
  const inferred = await inferQueryFilters(
    aiReturning('{"category":"","color":""}'),
    "青いタオルを探しています",
    categories,
    colors,
  );
  expect(inferred).toEqual({ category: "タオル", color: "青" });
});

test("専用カテゴリがないキーホルダーはアクセサリーに寄せる", async () => {
  const inferred = await inferQueryFilters(
    aiReturning('{"category":"","color":""}'),
    "黒い猫のキーホルダー",
    categories,
    colors,
  );
  expect(inferred).toEqual({ category: "アクセサリー", color: "黒" });
});

test("ハンカチをタオルへ丸めず専用カテゴリにする", async () => {
  const inferred = await inferQueryFilters(
    aiReturning('{"category":"","color":""}'),
    "赤いハンカチ",
    categories,
    colors,
  );
  expect(inferred).toEqual({ category: "ハンカチ", color: "赤" });
});

test("表記揺れしたハンディファンを本番カテゴリへ寄せる", async () => {
  const inferred = await inferQueryFilters(
    aiReturning('{"category":"","color":""}'),
    "黒いハンディファン",
    categories,
    colors,
  );
  expect(inferred).toEqual({ category: "ハンディーファン", color: "黒" });
});

test("ローカル判定できない語だけAIの選択肢判定で補完する", async () => {
  const inferred = await inferQueryFilters(
    aiReturning('{"category":"アクセサリー","color":"赤"}'),
    "ルビー色のブローチ",
    categories,
    colors,
  );
  expect(inferred).toEqual({ category: "アクセサリー", color: "赤" });
});
