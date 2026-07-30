import type { Store } from "../store/index.ts";
import type { Item, Inquiry, Match } from "../types.ts";

export interface MatchOutcome {
  matches: Match[];
  topScore: number;
}

/**
 * カテゴリ整合ガード。双方がカテゴリを指定していて異なる場合は突き合わせ対象外。
 * ベクトル類似度だけに頼らず、種別違いの誤検知（傘×財布 等）を防ぐ。
 */
function categoryConsistent(a: string, b: string): boolean {
  if (!a || !b) return true;
  return a === b;
}

/**
 * 新規登録された「遺失物」を、未解決の問い合わせ群に突き合わせる。
 * しきい値以上を候補（pending）として保存し、スタッフに通知する。
 */
export async function matchNewItem(
  store: Store,
  item: Item,
  threshold: number,
): Promise<MatchOutcome> {
  if (!item.embedding?.length) {
    // pg 実装では list からベクトルが返らないので取得元の embedding を使う
  }
  const openInquiries = await store.listOpenInquiries();
  const scored = await scoreInquiries(store, item, openInquiries);
  const hits = scored.filter(
    (s) => s.score >= threshold && categoryConsistent(item.category, s.inquiry.category),
  );
  const matches: Match[] = [];
  for (const { inquiry, score } of hits) {
    const existing = await store.findMatch(item.id, inquiry.id);
    // 既知の組み合わせは再通知しない。
    // 否定済み(rejected)はもちろん、確認待ち(pending)や確定済みも対象。
    // 物品を編集するたびに同じ通知が積み上がるとスタッフが通知を無視するようになるため。
    if (existing) continue;
    const m = await store.createMatch({
      item_id: item.id,
      inquiry_id: inquiry.id,
      score,
      status: "pending",
      direction: "item_to_inquiry",
    });
    matches.push(m);
    await store.updateInquiry(inquiry.id, { status: "matched" });
    await store.createNotification({
      type: "match_found",
      title: "遺失物と問い合わせが一致した可能性",
      body:
        `新規登録「${label(item)}」が、問い合わせ(受付No: ${inquiry.reference_no || "—"})` +
        `と ${(score * 100).toFixed(0)}% 一致しました。確認してください。`,
      ref_item_id: item.id,
      ref_inquiry_id: inquiry.id,
      ref_match_id: m.id,
    });
  }
  return { matches, topScore: scored[0]?.score ?? 0 };
}

/**
 * 新規登録された「問い合わせ」を、保管中の遺失物に突き合わせる。
 * 一致がなければ問い合わせは open のまま保存され、後日の新規遺失物登録時に
 * matchNewItem 側で自動照合される。
 */
export async function matchNewInquiry(
  store: Store,
  inquiry: Inquiry,
  threshold: number,
): Promise<MatchOutcome> {
  const scored = await store.searchItems(inquiry.embedding, {
    status: "stored",
    limit: 20,
  });
  const hits = scored.filter(
    (s) => s.score >= threshold && categoryConsistent(inquiry.category, s.category),
  );
  const matches: Match[] = [];
  for (const it of hits) {
    const existing = await store.findMatch(it.id, inquiry.id);
    if (existing) continue; // 既知の組み合わせは再通知しない
    const m = await store.createMatch({
      item_id: it.id,
      inquiry_id: inquiry.id,
      score: it.score,
      status: "pending",
      direction: "inquiry_to_item",
    });
    matches.push(m);
    await store.createNotification({
      type: "match_found",
      title: "問い合わせに一致する遺失物候補",
      body:
        `問い合わせ(受付No: ${inquiry.reference_no || "—"})に対し、保管中の` +
        `「${label(it)}」が ${(it.score * 100).toFixed(0)}% 一致しました。`,
      ref_item_id: it.id,
      ref_inquiry_id: inquiry.id,
      ref_match_id: m.id,
    });
  }
  if (matches.length > 0) {
    await store.updateInquiry(inquiry.id, { status: "matched" });
  }
  return { matches, topScore: scored[0]?.score ?? 0 };
}

/**
 * item の embedding で各 inquiry を採点。pg 実装では inquiry.embedding が
 * 返らないため searchInquiries（SQL 側計算）を使い、open 集合と突き合わせる。
 */
async function scoreInquiries(
  store: Store,
  item: Item,
  openInquiries: Inquiry[],
): Promise<{ inquiry: Inquiry; score: number }[]> {
  if (openInquiries.length === 0) return [];
  const openIds = new Set(openInquiries.map((i) => i.id));
  const ranked = await store.searchInquiries(item.embedding, 50);
  const byId = new Map(openInquiries.map((i) => [i.id, i]));
  return ranked
    .filter((r) => openIds.has(r.id))
    .map((r) => ({ inquiry: byId.get(r.id)!, score: r.score }));
}

function label(x: Item): string {
  return [x.color, x.brand, x.category].filter(Boolean).join(" ") || x.ai_description.slice(0, 20) || "物品";
}
