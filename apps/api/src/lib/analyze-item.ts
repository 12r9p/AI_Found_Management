import type { AppContext } from "../context.ts";
import type { Item } from "../types.ts";
import { itemEmbedText } from "./embed-text.ts";
import { arrayBufferToDataUrl } from "./img.ts";
import { matchNewItem } from "./matching.ts";
import { getMetaLists } from "./meta.ts";

/** 一時的な失敗（AI APIのタイムアウト等）を想定した簡易リトライ。
 * 各ステップは冪等（findMatch チェック・ai_status上書きのみ）なので再実行しても安全。
 * waitUntil には再試行キューが無いため、ここで吸収しておかないと1回失敗しただけで
 * ai_status:"error" のまま放置され、手動での「AIで特徴を解析」に頼ることになる。 */
async function withRetry<T>(fn: () => Promise<T>, attempts = 3, baseDelayMs = 300): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (i < attempts - 1) {
        await new Promise((r) => setTimeout(r, baseDelayMs * 2 ** i));
      }
    }
  }
  throw lastErr;
}

async function analyzeOnce(c: AppContext, item: Item): Promise<void> {
  const dataUrls: string[] = [];
  for (const key of item.image_keys) {
    const obj = await c.images.get(key);
    if (obj) dataUrls.push(arrayBufferToDataUrl(obj.body, obj.contentType));
  }
  const { categories, colors } = await getMetaLists(c.store);
  const d = await c.ai.describeImages(dataUrls.map((url) => ({ url })), { hint: item.notes, categories, colors });
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
}

/**
 * 画像のAI解析（種別・色・特徴文・タグ）とベクトル埋め込み・自動照合を
 * 登録レスポンスの後ろでバックグラウンド実行する（waitUntil経由）。
 * 現場では手が空くまで待てないため、登録自体はこの完了を待たない。
 * 一致が見つかれば既存の通知の仕組み（NotificationsPopup）でスタッフに届く。
 */
export async function runBackgroundAnalysis(c: AppContext, item: Item): Promise<void> {
  try {
    await withRetry(() => analyzeOnce(c, item));
  } catch (e) {
    console.error("[background analysis]", e);
    await c.store.updateItem(item.id, { ai_status: "error" }).catch(() => {});
  }
}
