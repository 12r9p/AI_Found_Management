"use client";
import { useState } from "react";
import { AppShell } from "../../components/AppShell";
import { Button, Card, Field, Input, Select, Badge, Modal, Textarea, useToast } from "../../components/ui";
import { useMeta } from "../../components/useMeta";
import { useLocationPresets } from "../../components/useLocationPresets";
import { usePersistentState } from "../../components/usePersistentState";
import { ItemLookupModal } from "../../components/ItemLookupModal";
import { ItemEditModal } from "../../components/ItemEditModal";
import { api, imageUrl } from "../../lib/api";
import { STATUS_LABEL, type Item } from "../../lib/types";

const EMPTY_FILTERS = { category: "", color: "", status: "", location: "", from: "", to: "" };

export default function SearchPage() {
  const meta = useMeta();
  const presets = useLocationPresets();
  const toast = useToast();
  // 検索条件と結果を保持（照会ポップアップを閉じても検索し直さなくてよい）
  const [q, setQ] = usePersistentState("search:q", "");
  const [filters, setFilters] = usePersistentState("search:filters", EMPTY_FILTERS);
  const [items, setItems] = usePersistentState<Item[] | null>("search:results", null);
  const [loading, setLoading] = useState(false);

  // 「意味検索(AI)」= 自然文をAIで埋め込んで探す（従来通り）。
  // 「似た物品を探す」= 既存物品のベクトルをそのまま流用（AI呼び出し無し）。
  const [mode, setMode] = usePersistentState<"ai" | "similar">("search:mode", "ai");
  const [refDisplayId, setRefDisplayId] = usePersistentState("search:refDisplayId", "");
  const [refItem, setRefItem] = useState<Item | null>(null);
  const [refLoading, setRefLoading] = useState(false);

  const [inqOpen, setInqOpen] = useState(false);
  const [inqRef, setInqRef] = useState("");
  const [inqBusy, setInqBusy] = useState(false);

  const [lookup, setLookup] = useState<Item | null>(null);
  const [editing, setEditing] = useState<Item | null>(null);

  const setF = (k: keyof typeof filters, v: string) => setFilters((f) => ({ ...f, [k]: v }));

  /** 管理番号から対象物品を確認する（似た物品を探すモード用）。 */
  const lookupRef = async () => {
    if (!refDisplayId.trim()) return;
    setRefLoading(true);
    try {
      const found = await api.findItemByDisplayId(refDisplayId.trim());
      if (!found) toast("該当する管理番号の物品が見つかりません", "error");
      setRefItem(found);
    } catch (e) {
      toast(`確認に失敗しました: ${(e as Error).message}`, "error");
    } finally {
      setRefLoading(false);
    }
  };

  const doSearch = async () => {
    if (mode === "similar" && !refItem) {
      toast("管理番号を入力して対象の物品を確認してください", "error");
      return;
    }
    setLoading(true);
    try {
      const res =
        mode === "similar"
          ? await api.search({ likeItemId: refItem!.id, ...filters, limit: 50 })
          : await api.search({ q: q || undefined, ...filters, limit: 50 });
      setItems(res);
      if (res.length === 0) toast("該当なし。特徴を『未解決』として登録できます", "error");
    } catch (e) {
      toast(`検索失敗: ${(e as Error).message}`, "error");
    } finally {
      setLoading(false);
    }
  };

  /** 一覧内の1件だけ差し替える（再検索せずに状態表示を最新化） */
  const patchLocal = (updated: Item) =>
    setItems((list) => (list ? list.map((x) => (x.id === updated.id ? { ...x, ...updated } : x)) : list));

  /** 編集画面から削除された物品を結果一覧からも消す。 */
  const removeLocal = (id: string) =>
    setItems((list) => (list ? list.filter((x) => x.id !== id) : list));

  /** 返却済みにした直後。誤操作をすぐ戻せるようトーストに取り消しを出す。 */
  const handleReturned = (item: Item, prevStatus: Item["status"]) => {
    patchLocal({ ...item, status: "returned" });
    toast(`「${item.display_id || item.category}」を返却済みにしました`, {
      tone: "success",
      action: {
        label: "取り消す",
        onClick: async () => {
          try {
            const { item: reverted } = await api.updateItem(item.id, { status: prevStatus });
            patchLocal(reverted);
            toast("返却を取り消しました", "success");
          } catch (e) {
            toast(`取り消しに失敗しました: ${(e as Error).message}`, "error");
          }
        },
      },
    });
  };

  const registerInquiry = async () => {
    if (!q.trim() && !filters.category) {
      toast("探し物の特徴（検索文）またはカテゴリを入力してください", "error");
      return;
    }
    setInqBusy(true);
    try {
      const res = await api.createInquiry({
        reference_no: inqRef,
        description: q,
        category: filters.category,
        color: filters.color,
      });
      if (res.matches.length > 0) {
        toast(`保管中の物品と${res.matches.length}件一致しました。照合画面で確認してください`, "success");
      } else {
        toast("未解決として保存しました。新規登録時に自動照合されます", "success");
      }
      setInqOpen(false);
      setInqRef("");
    } catch (e) {
      toast(`登録失敗: ${(e as Error).message}`, "error");
    } finally {
      setInqBusy(false);
    }
  };

  const hasConditions = !!q || !!refDisplayId || Object.values(filters).some(Boolean) || !!items;

  return (
    <AppShell>
      <h2 className="mb-16">遺失物を探す</h2>

      {/* 条件は左に固定、結果は右。条件を見ながら結果を絞り込める。 */}
      <div className="rb-split">
        <div className="rb-split__side">
          <Card variant="bordered">
            <div className="rb-row mb-16" style={{ gap: 4 }}>
              <Button variant={mode === "ai" ? undefined : "outline"} size="sm" onClick={() => setMode("ai")}>
                意味検索(AI)
              </Button>
              <Button variant={mode === "similar" ? undefined : "outline"} size="sm" onClick={() => setMode("similar")}>
                似た物品を探す
              </Button>
            </div>

            {mode === "ai" ? (
              <Field label="特徴で検索" hint="自然文でOK（例: 黒い革の長財布）">
                {(id) => (
                  <Input
                    id={id}
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    // IME 変換確定の Enter で検索が走らないようにする
                    onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && doSearch()}
                    placeholder="紺色の折りたたみ傘 …"
                  />
                )}
              </Field>
            ) : (
              <>
                <Field label="管理番号で対象物品を指定" hint="AIを呼ばず、その物品のベクトルをそのまま使って探します">
                  {(id) => (
                    <div className="rb-row" style={{ flexWrap: "nowrap" }}>
                      <Input
                        id={id}
                        value={refDisplayId}
                        onChange={(e) => { setRefDisplayId(e.target.value); setRefItem(null); }}
                        onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && lookupRef()}
                        placeholder="FD-20260731-0001"
                      />
                      <Button variant="outline" onClick={lookupRef} disabled={refLoading}>
                        {refLoading ? "確認中…" : "確認"}
                      </Button>
                    </div>
                  )}
                </Field>
                {refItem && (
                  <Card variant="muted" className="mb-16">
                    <div className="rb-row" style={{ gap: 8, alignItems: "center" }}>
                      {refItem.image_keys[0] ? (
                        <img src={imageUrl(refItem.image_keys[0])} alt="" className="rb-thumb-sm" />
                      ) : (
                        <span className="rb-thumb-sm rb-thumb-sm--empty">無</span>
                      )}
                      <div>
                        <div className="rb-small">
                          <strong>{[refItem.color, refItem.category].filter(Boolean).join(" ") || "物品"}</strong>
                        </div>
                        <div className="rb-tiny muted-text">{refItem.display_id}</div>
                      </div>
                    </div>
                  </Card>
                )}
              </>
            )}

            <div className="rb-eyebrow mt-16 mb-8">フィルター</div>
            <Field label="種別">
              {(id) => (
                <Select id={id} value={filters.category} onChange={(e) => setF("category", e.target.value)}>
                  <option value="">すべて</option>
                  {meta.categories.map((c) => <option key={c}>{c}</option>)}
                </Select>
              )}
            </Field>
            <Field label="色">
              {(id) => (
                <Select id={id} value={filters.color} onChange={(e) => setF("color", e.target.value)}>
                  <option value="">すべて</option>
                  {meta.colors.map((c) => <option key={c}>{c}</option>)}
                </Select>
              )}
            </Field>
            <Field label="状態">
              {(id) => (
                <Select id={id} value={filters.status} onChange={(e) => setF("status", e.target.value)}>
                  <option value="">すべて</option>
                  {meta.itemStatuses.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                </Select>
              )}
            </Field>
            <Field label="拾得場所">
              {(id) => (
                <Select id={id} value={filters.location} onChange={(e) => setF("location", e.target.value)}>
                  <option value="">すべて</option>
                  {presets.map((p) => <option key={p.name}>{p.name}</option>)}
                </Select>
              )}
            </Field>
            {/* 条件カラムは狭いので日付は縦積み（横並びだと入力欄が潰れる） */}
            <Field label="拾得日 (から)">
              {(id) => <Input id={id} type="date" value={filters.from} onChange={(e) => setF("from", e.target.value)} />}
            </Field>
            <Field label="拾得日 (まで)">
              {(id) => <Input id={id} type="date" value={filters.to} onChange={(e) => setF("to", e.target.value)} />}
            </Field>

            <Button block onClick={doSearch} disabled={loading || (mode === "similar" && !refItem)}>
              {loading ? "検索中…" : "検索"}
            </Button>
            <div className="rb-row mt-8">
              <Button variant="outline" size="sm" onClick={() => setInqOpen(true)}>
                該当なし → 未解決で登録
              </Button>
              {hasConditions && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setQ("");
                    setFilters(EMPTY_FILTERS);
                    setItems(null);
                    setRefDisplayId("");
                    setRefItem(null);
                  }}
                >
                  条件をクリア
                </Button>
              )}
            </div>
          </Card>
        </div>

        <div>
          {loading && (
            <div className="rb-busy mb-16" role="status" aria-live="polite">
              <span className="rb-spinner" aria-hidden />
              <span>{mode === "similar" ? "似た物品を探しています…" : "AIが特徴を照合中…"}</span>
            </div>
          )}

          {!items && !loading && (
            <Card variant="muted">
              <p className="rb-small" style={{ margin: 0 }}>
                {mode === "similar"
                  ? "管理番号で対象の物品を指定して検索してください。"
                  : "左の条件を入力して検索してください。特徴を文章で入れるとAIが近いものを探します。"}
              </p>
            </Card>
          )}

          {items && (
            <>
              <div className="rb-between mb-8">
                <div className="rb-eyebrow">結果 {items.length} 件</div>
              </div>
              {items.length === 0 ? (
                <Card variant="muted">
                  <p className="rb-small" style={{ margin: 0 }}>
                    該当する物品が見つかりませんでした。「未解決で登録」しておくと、後日一致する遺失物が
                    登録された際にスタッフへ自動通知されます。
                  </p>
                </Card>
              ) : (
                <div className="rb-grid rb-grid--auto">
                  {items.map((it) => (
                    <Card
                      key={it.id}
                      variant="interactive"
                      style={{ height: "100%" }}
                      role="button"
                      tabIndex={0}
                      onClick={() => setLookup(it)}
                      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && setLookup(it)}
                    >
                      <div className="rb-between mb-8">
                        <strong>{[it.color, it.category].filter(Boolean).join(" ") || "物品"}</strong>
                        {typeof it.score === "number" && it.score != null && (
                          <Badge tone={it.score >= 0.6 ? "success" : "info"}>{(it.score * 100).toFixed(0)}%</Badge>
                        )}
                      </div>
                      {it.display_id && (
                        <div className="rb-mono rb-tiny muted-text mb-8">{it.display_id}</div>
                      )}
                      {it.image_keys[0] ? (
                        <img src={imageUrl(it.image_keys[0])} alt="" className="thumb mb-8" />
                      ) : (
                        <div className="thumb thumb--empty mb-8">画像なし</div>
                      )}
                      <div className="rb-row mb-8" style={{ gap: 6 }}>
                        <Badge>{STATUS_LABEL[it.status]}</Badge>
                        <span className="rb-tiny muted-text">拾得場所: {it.found_location || "—"}</span>
                      </div>
                      <p className="rb-small" style={{ margin: 0 }}>{it.ai_description.slice(0, 80)}</p>
                    </Card>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* 照会 → 返却/編集 */}
      <ItemLookupModal
        item={lookup}
        context="探す"
        onClose={() => setLookup(null)}
        onReturned={handleReturned}
        onEdit={(it) => {
          setLookup(null);
          setEditing(it);
        }}
      />
      <ItemEditModal
        item={editing}
        context="探す › 照会"
        onClose={() => setEditing(null)}
        onSaved={patchLocal}
        onDeleted={removeLocal}
      />

      <Modal
        open={inqOpen}
        title="未解決の問い合わせを登録"
        context="探す"
        onClose={() => setInqOpen(false)}
        footer={
          <>
            <Button variant="outline" onClick={() => setInqOpen(false)}>キャンセル</Button>
            <Button onClick={registerInquiry} disabled={inqBusy}>{inqBusy ? "登録中" : "登録"}</Button>
          </>
        }
      >
        <p className="rb-small">
          探し物の特徴を未解決として保存します。<strong>個人情報は入力しないでください</strong>。
          連絡先等は紙台帳で管理し、ここには受付番号のみ記録します。
        </p>
        <Field label="受付番号（紙台帳）" hint="個人情報ではありません">
          {(id) => <Input id={id} value={inqRef} onChange={(e) => setInqRef(e.target.value)} placeholder="R-1004" />}
        </Field>
        <Field label="特徴（検索文を引用）">
          {(id) => <Textarea id={id} value={q} onChange={(e) => setQ(e.target.value)} />}
        </Field>
        <div className="rb-tiny muted-text">
          種別: {filters.category || "未指定"} / 色: {filters.color || "未指定"}
        </div>
      </Modal>
    </AppShell>
  );
}
