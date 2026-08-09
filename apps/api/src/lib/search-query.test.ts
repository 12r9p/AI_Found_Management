import { expect, test } from "bun:test";
import { buildSemanticSearchText, strictSearchFilters } from "./search-query.ts";

test("特徴・カテゴリ・色・拾得場所をラベル付きの検索文へまとめる", () => {
  expect(
    buildSemanticSearchText({
      q: "刺繍のある布製品",
      category: "タオル",
      color: "青",
      location: "東門",
      status: "stored",
      from: "2026-08-01",
      display_id: "FD-001",
    }),
  ).toBe("特徴: 刺繍のある布製品\nカテゴリ: タオル\n色: 青\n拾得場所: 東門");
});

test("特徴文がなくても選択した属性だけで検索文を作れる", () => {
  expect(buildSemanticSearchText({ category: "タオル", color: "白" })).toBe(
    "カテゴリ: タオル\n色: 白",
  );
});

test("状態・日付・管理番号だけを厳密条件として残す", () => {
  expect(
    strictSearchFilters({
      q: "刺繍入り",
      category: "タオル",
      color: "青",
      location: "東門",
      display_id: "FD-001",
      status: "stored",
      from: "2026-08-01",
      to: "2026-08-09",
      limit: 20,
    }),
  ).toEqual({
    display_id: "FD-001",
    status: "stored",
    from: "2026-08-01",
    to: "2026-08-09",
    limit: 20,
  });
});
