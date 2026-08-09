import type { Store } from "../store/store.ts";

export interface ThresholdStats {
  status: "sufficient_data" | "insufficient_data";
  sampleCount: number;
  currentThreshold: number;
  recommendedThreshold: number;
  message: string;
  distribution: {
    min: number;
    max: number;
    average: number;
    p5: number;
    p50: number;
  } | null;
}

export const MATCH_THRESHOLD_SETTING_KEY = "match_threshold";

/**
 * ストアの設定から実効のしきい値を取得する。未設定なら指定されたデフォルト値（または0.5）を返す。
 */
export async function getEffectiveThreshold(store: Store, fallback = 0.5): Promise<number> {
  const val = await store.getSetting(MATCH_THRESHOLD_SETTING_KEY);
  if (!val) return fallback;
  const num = parseFloat(val);
  return Number.isNaN(num) ? fallback : num;
}

/**
 * 過去の照合・確定実績（Match status == 'confirmed'）から
 * 動的しきい値を統計的に試算する。
 */
export async function calculateThresholdStats(
  store: Store,
  fallbackDefault = 0.5,
): Promise<ThresholdStats> {
  const currentThreshold = await getEffectiveThreshold(store, fallbackDefault);
  const confirmedMatches = await store.listMatches("confirmed");

  // スコア配列の抽出
  const scores = confirmedMatches
    .map((m) => m.score)
    .filter((s) => typeof s === "number" && !Number.isNaN(s))
    .sort((a, b) => a - b);

  const count = scores.length;

  if (count < 5) {
    return {
      status: "insufficient_data",
      sampleCount: count,
      currentThreshold,
      recommendedThreshold: fallbackDefault,
      message: `返却確定データが${count}件のため、実績蓄積中（5件未満）です。安全策として既定しきい値 (${fallbackDefault.toFixed(2)}) を推奨します。`,
      distribution: null,
    };
  }

  const sum = scores.reduce((acc, val) => acc + val, 0);
  const min = scores[0];
  const max = scores[count - 1];
  const average = Number((sum / count).toFixed(3));
  // 下位5% (p5): 成功例の95%を包摂する下限値
  const p5Index = Math.max(0, Math.floor(count * 0.05));
  const p5 = Number(scores[p5Index].toFixed(3));
  // 中央値 (p50)
  const p50Index = Math.floor(count * 0.5);
  const p50 = Number(scores[p50Index].toFixed(3));

  // 推奨値は p5 (下位5%) を基準とし、過度な変動を防ぐため 0.35 〜 0.70 に制限する
  const recommendedRaw = p5;
  const recommendedThreshold = Number(Math.max(0.35, Math.min(0.7, recommendedRaw)).toFixed(2));

  return {
    status: "sufficient_data",
    sampleCount: count,
    currentThreshold,
    recommendedThreshold,
    message: `過去${count}件の確定実績から、下位5%水準 (p5 = ${p5.toFixed(2)}) を元に推奨しきい値 ${recommendedThreshold.toFixed(2)} を算出しました。`,
    distribution: {
      min: Number(min.toFixed(3)),
      max: Number(max.toFixed(3)),
      average,
      p5,
      p50,
    },
  };
}
