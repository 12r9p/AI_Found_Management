import type { AppContext } from "../context.ts";
import type { Item } from "../types.ts";
import { itemEmbedText } from "./embed-text.ts";
import { arrayBufferToDataUrl } from "./img.ts";
import { matchNewItem } from "./matching.ts";

/**
 * 画像のAI解析（種別・色・特徴文・タグ）とベクトル埋め込み・自動照合を
 * 登録レスポンスの後ろでバックグラウンド実行する（waitUntil経由）。
 * 現場では手が空くまで待てないため、登録自体はこの完了を待たない。
 * 一致が見つかれば既存の通知の仕組み（NotificationsPopup）でスタッフに届く。
 */
export async function runBackgroundAnalysis(c: AppContext, item: Item): Promise<void> {
  try {
    const dataUrls: string[] = [];
    for (const key of item.image_keys) {
      const obj = await c.images.get(key);
      if (obj) dataUrls.push(arrayBufferToDataUrl(obj.body, obj.contentType));
    }
    const d = await c.ai.describeImages(dataUrls.map((url) => ({ url })), item.notes);
    const patch = {
      ai_description: d.description,
      tags: d.tags,
      // 人間が既に入力していた項目はAIの推定で上書きしない
      category: item.category || d.category,
      color: item.color || d.color,
      brand: item.brand || d.brand,
    };
    const embedding = await c.ai.embed(itemEmbedText({ ...item, ...patch }));
    const updated = await c.store.updateItem(item.id, {
      ...patch,
      embedding,
      ai_status: "ready",
    });
    if (updated && updated.status === "stored") {
      await matchNewItem(c.store, { ...updated, embedding }, c.cfg.matchThreshold);
    }
  } catch (e) {
    console.error("[background analysis]", e);
    await c.store.updateItem(item.id, { ai_status: "error" }).catch(() => {});
  }
}
