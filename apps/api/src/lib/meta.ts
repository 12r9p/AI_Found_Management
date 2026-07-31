import type { Store } from "../store/index.ts";

export const CATEGORIES = [
  "財布", "かばん", "傘", "スマートフォン", "携帯電話", "鍵", "水筒",
  "眼鏡", "帽子", "衣類", "イヤホン", "時計", "アクセサリー", "書類",
  "カード類", "現金", "おもちゃ", "その他",
];
export const COLORS = [
  "黒", "白", "灰", "紺", "青", "水色", "赤", "ピンク", "橙", "黄",
  "緑", "茶", "ベージュ", "紫", "金", "銀", "透明", "その他",
];
export const ITEM_STATUSES = ["stored", "returned", "disposed", "transferred"];
export const INQUIRY_STATUSES = ["open", "matched", "resolved", "closed"];

/** 設定に保存されたリスト（種別・色）を読む。未設定・壊れていれば既定値。 */
export async function readList(
  store: Store,
  key: string,
  fallback: string[],
): Promise<string[]> {
  const raw = await store.getSetting(key);
  if (!raw) return fallback;
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) && v.length ? v.map(String) : fallback;
  } catch {
    return fallback;
  }
}

/** AIの種別・色推定を、スタッフが設定画面で編集できる選択肢に合わせるためのヒント。
 * 表記ゆれ（「スマホ」vs「スマートフォン」）でフィルタ絞り込みから漏れるのを防ぐ。 */
export async function getMetaLists(store: Store): Promise<{ categories: string[]; colors: string[] }> {
  const [categories, colors] = await Promise.all([
    readList(store, "categories", CATEGORIES),
    readList(store, "colors", COLORS),
  ]);
  return { categories, colors };
}
