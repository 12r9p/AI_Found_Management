import type { Store } from "../store/index.ts";

/** 種別・色の選択肢1件。並び順は配列順、グループ分け・色タグは任意。 */
export interface MetaOption {
  name: string;
  /** 選択肢をまとめる見出し（未設定なら無所属としてグループ無しで表示）。 */
  group?: string;
  /** 色スウォッチ表示用のhex値（主に色リストで使う想定だが種別でも設定可）。 */
  color?: string;
}

const DEFAULT_CATEGORIES: MetaOption[] = [
  "財布", "かばん", "傘", "スマートフォン", "携帯電話", "鍵", "水筒",
  "眼鏡", "帽子", "衣類", "イヤホン", "時計", "アクセサリー", "書類",
  "カード類", "現金", "おもちゃ", "その他",
].map((name) => ({ name }));

// 色名からの色は「だいたいこの色」という目安（正式な色見本ではない）。
const DEFAULT_COLORS: MetaOption[] = [
  { name: "黒", color: "#1a1a1a" },
  { name: "白", color: "#f5f5f5" },
  { name: "灰", color: "#9e9e9e" },
  { name: "紺", color: "#1e3a5f" },
  { name: "青", color: "#2563eb" },
  { name: "水色", color: "#7dd3fc" },
  { name: "赤", color: "#dc2626" },
  { name: "ピンク", color: "#f472b6" },
  { name: "橙", color: "#f97316" },
  { name: "黄", color: "#facc15" },
  { name: "緑", color: "#16a34a" },
  { name: "茶", color: "#92400e" },
  { name: "ベージュ", color: "#d8c3a5" },
  { name: "紫", color: "#9333ea" },
  { name: "金", color: "#d4af37" },
  { name: "銀", color: "#c0c0c0" },
  { name: "透明" },
  { name: "その他" },
];

// 後方互換用に文字列配列としても公開（AIプロンプトのヒント生成などで使う）。
export const CATEGORIES = DEFAULT_CATEGORIES.map((o) => o.name);
export const COLORS = DEFAULT_COLORS.map((o) => o.name);
export const ITEM_STATUSES = ["stored", "returned", "disposed", "transferred"];
export const INQUIRY_STATUSES = ["open", "matched", "resolved", "closed"];

const HEX_RE = /^#[0-9a-fA-F]{3,8}$/;

/** 保存/APIからの入力を検証・整形する。壊れた項目は捨て、名前の重複は先勝ち。 */
export function normalizeMetaOptions(input: any): MetaOption[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: MetaOption[] = [];
  for (const raw of input) {
    const name = String(raw?.name ?? "").trim().slice(0, 40);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    const group = typeof raw?.group === "string" ? raw.group.trim().slice(0, 40) : "";
    const color = typeof raw?.color === "string" && HEX_RE.test(raw.color.trim()) ? raw.color.trim() : "";
    out.push({ name, ...(group ? { group } : {}), ...(color ? { color } : {}) });
    if (out.length >= 200) break;
  }
  return out;
}

/** 旧形式（文字列配列）・新形式（MetaOption配列）どちらで保存されていても読めるようにする。 */
function coerceOptions(v: any, fallback: MetaOption[]): MetaOption[] {
  if (!Array.isArray(v) || v.length === 0) return fallback;
  if (typeof v[0] === "string") return v.map((name: any) => ({ name: String(name) }));
  return normalizeMetaOptions(v);
}

/** 設定に保存された種別・色の選択肢を読む（並び順・グループ・色タグ込み）。未設定・壊れていれば既定値。 */
export async function readMetaOptions(
  store: Store,
  key: string,
  fallback: MetaOption[],
): Promise<MetaOption[]> {
  const raw = await store.getSetting(key);
  if (!raw) return fallback;
  try {
    return coerceOptions(JSON.parse(raw), fallback);
  } catch {
    return fallback;
  }
}

export async function getMetaOptions(
  store: Store,
): Promise<{ categories: MetaOption[]; colors: MetaOption[] }> {
  const [categories, colors] = await Promise.all([
    readMetaOptions(store, "categories", DEFAULT_CATEGORIES),
    readMetaOptions(store, "colors", DEFAULT_COLORS),
  ]);
  return { categories, colors };
}

/** 設定に保存されたリスト（種別・色）を名前だけの配列で読む。未設定・壊れていれば既定値。 */
export async function readList(
  store: Store,
  key: string,
  fallback: string[],
): Promise<string[]> {
  const raw = await store.getSetting(key);
  if (!raw) return fallback;
  try {
    const v = JSON.parse(raw);
    if (!Array.isArray(v) || v.length === 0) return fallback;
    return typeof v[0] === "string" ? v.map(String) : v.map((o: any) => String(o?.name ?? "")).filter(Boolean);
  } catch {
    return fallback;
  }
}

/** AIの種別・色推定を、スタッフが設定画面で編集できる選択肢に合わせるためのヒント（名前のみでよい）。
 * 表記ゆれ（「スマホ」vs「スマートフォン」）でフィルタ絞り込みから漏れるのを防ぐ。 */
export async function getMetaLists(store: Store): Promise<{ categories: string[]; colors: string[] }> {
  const [categories, colors] = await Promise.all([
    readList(store, "categories", CATEGORIES),
    readList(store, "colors", COLORS),
  ]);
  return { categories, colors };
}
