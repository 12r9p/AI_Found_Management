import type { SearchFilters } from "../types.ts";

/**
 * スタッフが入力・選択した物品属性を、検索用の1つの文章へまとめる。
 * カテゴリ・色・場所は登録時にも埋め込みへ含めているため、完全一致ではなく
 * 特徴文と同じベクトル空間で検索順位へ反映する。
 */
export function buildSemanticSearchText(filters: SearchFilters): string {
  const parts = [
    semanticPart("特徴", filters.q),
    semanticPart("カテゴリ", filters.category),
    semanticPart("色", filters.color),
    semanticPart("拾得場所", filters.location),
  ];
  return parts.filter(Boolean).join("\n");
}

/** ベクトル検索後も候補から除外してよい、明示的な厳密条件だけを残す。 */
export function strictSearchFilters(filters: SearchFilters): SearchFilters {
  return {
    display_id: filters.display_id,
    status: filters.status,
    from: filters.from,
    to: filters.to,
    limit: filters.limit,
  };
}

function semanticPart(label: string, value: string | undefined): string {
  const normalized = value?.trim();
  return normalized ? `${label}: ${normalized}` : "";
}
