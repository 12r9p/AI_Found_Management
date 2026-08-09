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

test("検索文から色のみを判定し、種別（カテゴリ）は自動補完せず空文字にする", async () => {
  const inferred = await inferQueryFilters(
    aiReturning('{"color":""}'),
    "青いタオルを探しています",
    categories,
    colors,
  );
  expect(inferred).toEqual({ category: "", color: "青" });
});

test("ローカル判定できない色のみAIで補完し種別は空文字にする", async () => {
  const inferred = await inferQueryFilters(
    aiReturning('{"color":"赤"}'),
    "ルビー色のブローチ",
    categories,
    colors,
  );
  expect(inferred).toEqual({ category: "", color: "赤" });
});
