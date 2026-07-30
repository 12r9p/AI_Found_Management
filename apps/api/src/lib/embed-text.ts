import type { Item, Inquiry } from "../types.ts";

/** 遺失物を検索・照合するための埋め込み対象テキストを合成。 */
export function itemEmbedText(i: Partial<Item>): string {
  return [
    i.category,
    i.color,
    i.brand,
    i.ai_description,
    (i.tags ?? []).join(" "),
    i.found_location,
    i.notes,
  ]
    .filter(Boolean)
    .join(" ");
}

/** 問い合わせ（探し物）の埋め込み対象テキストを合成。 */
export function inquiryEmbedText(i: Partial<Inquiry>): string {
  return [i.category, i.color, i.description, (i.tags ?? []).join(" "), i.notes]
    .filter(Boolean)
    .join(" ");
}
