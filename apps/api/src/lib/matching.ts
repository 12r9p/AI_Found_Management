import type { Store, MatchBulkEntry } from "../store/index.ts";
import type { ItemCursorPosition } from "../store/item-pagination.ts";
import type { Item, Inquiry, Match } from "../types.ts";
import type { AIProvider } from "../ai/provider.ts";
import { itemEmbedText } from "./embed-text.ts";

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
  const scored = await scoreInquiries(store, item);
  const hits = scored.filter(
    (s) => s.score >= threshold && categoryConsistent(item.category, s.inquiry.category),
  );
  if (hits.length === 0) return { matches: [], topScore: scored[0]?.score ?? 0 };

  // 既知の組み合わせは再通知しない（否定済み・確認待ち・確定済みいずれも対象）。
  // 物品を編集するたびに同じ通知が積み上がるとスタッフが通知を無視するようになるため。
  // 存在チェックは互いに独立した読み取りなので並行に行い、直列ラウンドトリップを避ける。
  const existing = await Promise.all(hits.map((h) => store.findMatch(item.id, h.inquiry.id)));
  const fresh = hits.filter((_, i) => !existing[i]);
  if (fresh.length === 0) return { matches: [], topScore: scored[0]?.score ?? 0 };

  const entries: MatchBulkEntry[] = fresh.map(({ inquiry, score }) => ({
    match: {
      item_id: item.id,
      inquiry_id: inquiry.id,
      score,
      status: "pending",
      direction: "item_to_inquiry",
    },
    inquiryStatusUpdate: { id: inquiry.id, status: "matched" },
    notification: {
      type: "match_found",
      title: "遺失物と問い合わせが一致した可能性",
      body:
        `新規登録「${label(item)}」が、問い合わせ(受付No: ${inquiry.reference_no || "—"})` +
        `と ${(score * 100).toFixed(0)}% 一致しました。確認してください。`,
      ref_item_id: item.id,
      ref_inquiry_id: inquiry.id,
    },
  }));
  const matches = await store.createMatchesBulk(entries);
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
  if (hits.length === 0) return { matches: [], topScore: scored[0]?.score ?? 0 };

  const existing = await Promise.all(hits.map((it) => store.findMatch(it.id, inquiry.id)));
  const fresh = hits.filter((_, i) => !existing[i]); // 既知の組み合わせは再通知しない
  if (fresh.length === 0) return { matches: [], topScore: scored[0]?.score ?? 0 };

  const entries: MatchBulkEntry[] = fresh.map((it) => ({
    match: {
      item_id: it.id,
      inquiry_id: inquiry.id,
      score: it.score,
      status: "pending",
      direction: "inquiry_to_item",
    },
    notification: {
      type: "match_found",
      title: "問い合わせに一致する遺失物候補",
      body:
        `問い合わせ(受付No: ${inquiry.reference_no || "—"})に対し、保管中の` +
        `「${label(it)}」が ${(it.score * 100).toFixed(0)}% 一致しました。`,
      ref_item_id: it.id,
      ref_inquiry_id: inquiry.id,
    },
    inquiryStatusUpdate: { id: inquiry.id, status: "matched" },
  }));
  const matches = await store.createMatchesBulk(entries);
  return { matches, topScore: scored[0]?.score ?? 0 };
}

/**
 * item の embedding で問い合わせを採点。searchInquiries は上位50件だけを返すため、
 * 未解決件数がどれだけ増えても全件をメモリに載せることはない
 * （以前は listOpenInquiries() で全未解決問い合わせを読み込んでから絞り込んでおり、
 * 件数が数万件規模になるとメモリを圧迫していた）。
 * 上位候補の現在の状態は searchInquiries の結果に対して個別に取得して確認する。
 */
async function scoreInquiries(
  store: Store,
  item: Item,
): Promise<{ inquiry: Inquiry; score: number }[]> {
  // 対応環境（Vectorizeのメタデータインデックス作成済み）ならクエリ時点で
  // open/matched のみに絞られる。未対応でも下の個別チェックで正しさは保たれる。
  const ranked = await store.searchInquiries(item.embedding, 50, { status: ["open", "matched"] });
  if (ranked.length === 0) return [];
  const inquiries = await Promise.all(ranked.map((r) => store.getInquiry(r.id)));
  const out: { inquiry: Inquiry; score: number }[] = [];
  for (let i = 0; i < ranked.length; i++) {
    const inq = inquiries[i];
    if (inq && (inq.status === "open" || inq.status === "matched")) {
      out.push({ inquiry: inq, score: ranked[i].score });
    }
  }
  return out;
}

function label(x: Item): string {
  return (
    [x.color, x.brand, x.category].filter(Boolean).join(" ") ||
    x.ai_description.slice(0, 20) ||
    "物品"
  );
}

export const REMATCH_PAGE_SIZE = 100;

export interface RematchPageOutcome {
  itemsChecked: number;
  matchesFound: number;
  failed: number;
  nextCursor: ItemCursorPosition | null;
  done: boolean;
}

/**
 * 保管中の物品を100件ずつ読み、埋め込みを再計算して未解決の問い合わせと再照合する。
 * しきい値の変更や、種別・色の表記を後から直した場合など、既存データには
 * 自動反映されない変更を追いつかせるため、管理画面がカーソルを渡しながら
 * この処理を順番に呼び出す。
 * embedding を都度取り直す（＝Vectorizeのメタデータも同時に更新される）ため、
 * 過去に登録された物品でもプレフィルタ用メタデータの取りこぼしを拾い直せる。
 * 1件の失敗（AI障害・モデルアクセス不可等）で残り全件を巻き込んで中断しないよう、
 * 物品ごとに独立してエラーを捕捉し、失敗件数を集計して返す。
 */
export async function rematchPage(
  store: Store,
  ai: AIProvider,
  threshold: number,
  cursor?: ItemCursorPosition,
): Promise<RematchPageOutcome> {
  const page = await store.listItems({ status: "stored" }, { cursor, limit: REMATCH_PAGE_SIZE });
  let matchesFound = 0;
  let failed = 0;
  for (const item of page.items) {
    try {
      const embedding = await ai.embed(itemEmbedText(item));
      const updated = await store.updateItem(item.id, { embedding, ai_status: "ready" });
      if (!updated) continue;
      const outcome = await matchNewItem(store, { ...updated, embedding }, threshold);
      matchesFound += outcome.matches.length;
    } catch (e) {
      failed++;
      console.error(
        JSON.stringify({
          event: "rematch_item_failed",
          itemId: item.id,
          error: e instanceof Error ? e.message : String(e),
        }),
      );
      await store.updateItem(item.id, { ai_status: "error" }).catch(() => {});
    }
  }
  return {
    itemsChecked: page.items.length,
    matchesFound,
    failed,
    nextCursor: page.nextCursor,
    done: page.nextCursor === null,
  };
}
