"use client";
import { Button as BaseButton } from "@base-ui/react/button";
import { useState } from "react";
import { AppShell } from "../../components/AppShell";
import {
  Button,
  Card,
  Field,
  Input,
  Select,
  Badge,
  Modal,
  Textarea,
  useToast,
  MetaOptionList,
  ColorSwatch,
} from "../../components/ui";
import { useMeta } from "../../components/useMeta";
import { useLocationPresets } from "../../components/useLocationPresets";
import { usePersistentState } from "../../components/usePersistentState";
import { ItemLookupModal } from "../../components/ItemLookupModal";
import { ItemEditModal } from "../../components/ItemEditModal";
import { FoundImage } from "../../components/FoundImage";
import { api, isAppliedApiError } from "../../lib/api";
import { STATUS_LABEL, type Item } from "../../lib/types";

const EMPTY_FILTERS = {
  category: "",
  color: "",
  status: "",
  location: "",
  from: "",
  to: "",
};

export default function SearchPage() {
  const meta = useMeta();
  const presets = useLocationPresets();
  const toast = useToast();
  // 検索条件と結果を保持（照会ポップアップを閉じても検索し直さなくてよい）
  const [q, setQ] = usePersistentState("search:q", "");
  const [filters, setFilters] = usePersistentState("search:filters:v3", EMPTY_FILTERS);
  const [items, setItems] = usePersistentState<Item[] | null>("search:results", null);
  const [loading, setLoading] = useState(false);
  const [degraded, setDegraded] = useState(false);

  const [inqOpen, setInqOpen] = useState(false);
  const [inqRef, setInqRef] = useState("");
  const [inqBusy, setInqBusy] = useState(false);

  const [lookup, setLookup] = useState<Item | null>(null);
  const [editing, setEditing] = useState<Item | null>(null);

  const setF = (k: keyof typeof filters, v: string) => setFilters((f) => ({ ...f, [k]: v }));

  const doSearch = async () => {
    setLoading(true);
    try {
      const { items: res, degraded: isDegraded } = await api.search({
        q: q || undefined,
        ...filters,
        limit: 50,
      });
      setItems(res);
      setDegraded(!!isDegraded);
      if (isDegraded) {
        toast("AI検索が利用できないため、絞り込み条件だけの結果を表示しています", "error");
      } else if (res.length === 0) {
        toast("該当なし。特徴を『未解決』として登録できます", "error");
      }
    } catch (e) {
      toast(`検索失敗: ${(e as Error).message}`, "error");
    } finally {
      setLoading(false);
    }
  };

  /** 一覧内の1件だけ差し替える（再検索せずに状態表示を最新化） */
  const patchLocal = (updated: Item) =>
    setItems((list) =>
      list ? list.map((x) => (x.id === updated.id ? { ...x, ...updated } : x)) : list,
    );

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
            if (isAppliedApiError(e)) {
              const reverted = await api
                .getItem(item.id)
                .then((result) => result.item)
                .catch(() => ({ ...item, status: prevStatus }) as Item);
              patchLocal(reverted);
              toast("返却の取り消しは反映済みです。検索データの同期は保留中です", "success");
              return;
            }
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
      const inferred = [res.inferredFilters.category, res.inferredFilters.color].filter(Boolean);
      if (res.matches.length > 0) {
        toast(
          `保管中の物品と${res.matches.length}件一致しました。照合画面で確認してください`,
          "success",
        );
      } else {
        toast(
          inferred.length > 0
            ? `未解決として保存しました（自動設定: ${inferred.join("・")}）。管理画面で修正できます`
            : "未解決として保存しました。新規登録時に自動照合されます",
          "success",
        );
      }
      setInqOpen(false);
      setInqRef("");
    } catch (e) {
      toast(`登録失敗: ${(e as Error).message}`, "error");
    } finally {
      setInqBusy(false);
    }
  };

  const hasConditions = !!q || Object.values(filters).some(Boolean) || !!items;

  return (
    <AppShell>
      <h2 className="mb-16">遺失物を探す</h2>

      {/* 条件は左に固定、結果は右。条件を見ながら結果を絞り込める。 */}
      <div className="rb-split">
        <div className="rb-split__side">
          <Card variant="bordered">
            <Field label="特徴で検索">
              {(id) => (
                <Input
                  id={id}
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  // IME 変換確定の Enter で検索が走らないようにする
                  onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && doSearch()}
                  placeholder="紺色の折りたたみ傘、管理番号 …"
                />
              )}
            </Field>

            <div className="rb-eyebrow mt-16 mb-8">検索条件</div>
            <Field label="種別" hint="完全一致ではなく、特徴と一緒に検索順位へ反映します">
              {(id) => (
                <Select
                  id={id}
                  value={filters.category}
                  onChange={(e) => setF("category", e.target.value)}
                >
                  <option value="">指定なし</option>
                  <MetaOptionList options={meta.categories} />
                </Select>
              )}
            </Field>
            <Field label="色" hint="完全一致ではなく、特徴と一緒に検索順位へ反映します">
              {(id) => (
                <Select
                  id={id}
                  value={filters.color}
                  onChange={(e) => setF("color", e.target.value)}
                >
                  <option value="">指定なし</option>
                  <MetaOptionList options={meta.colors} />
                </Select>
              )}
            </Field>
            <Field label="状態">
              {(id) => (
                <Select
                  id={id}
                  value={filters.status}
                  onChange={(e) => setF("status", e.target.value)}
                >
                  <option value="">すべて</option>
                  {meta.itemStatuses.map((s) => (
                    <option key={s} value={s}>
                      {STATUS_LABEL[s]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="拾得場所" hint="完全一致ではなく、特徴と一緒に検索順位へ反映します">
              {(id) => (
                <Select
                  id={id}
                  value={filters.location}
                  onChange={(e) => setF("location", e.target.value)}
                >
                  <option value="">指定なし</option>
                  {presets.map((p) => (
                    <option key={p.name}>{p.name}</option>
                  ))}
                </Select>
              )}
            </Field>
            {/* 条件カラムは狭いので日付は縦積み（横並びだと入力欄が潰れる） */}
            <Field label="拾得日 (から)">
              {(id) => (
                <Input
                  id={id}
                  type="date"
                  value={filters.from}
                  onChange={(e) => setF("from", e.target.value)}
                />
              )}
            </Field>
            <Field label="拾得日 (まで)">
              {(id) => (
                <Input
                  id={id}
                  type="date"
                  value={filters.to}
                  onChange={(e) => setF("to", e.target.value)}
                />
              )}
            </Field>

            <Button block onClick={doSearch} disabled={loading}>
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
                    setDegraded(false);
                  }}
                >
                  条件をクリア
                </Button>
              )}
            </div>
          </Card>
        </div>

        <div>
          {degraded && !loading && (
            <div className="rb-banner rb-banner--warning mb-16">
              <span>⚠ AI検索が利用できません。絞り込み条件だけの結果です</span>
            </div>
          )}

          {loading && (
            <output className="rb-busy mb-16" aria-live="polite">
              <span className="rb-spinner" aria-hidden />
              <span>ベクトル検索中…</span>
            </output>
          )}

          {!items && !loading && (
            <Card variant="muted">
              <p className="rb-small" style={{ margin: 0 }}>
                左の条件を入力して検索してください。特徴を文章で入れると、埋め込みベクトルの類似度で近いものを探します。
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
                    <BaseButton
                      key={it.id}
                      className="rb-card rb-card--interactive rb-interactive-card"
                      style={{ height: "100%" }}
                      onClick={() => setLookup(it)}
                      aria-label={`${it.display_id || [it.color, it.category].filter(Boolean).join(" ") || "物品"}の照会を開く`}
                    >
                      <span className="rb-between mb-8">
                        <strong className="rb-row" style={{ gap: 6 }}>
                          <ColorSwatch
                            color={meta.colors.find((c) => c.name === it.color)?.color}
                          />
                          {[it.color, it.category].filter(Boolean).join(" ") || "物品"}
                        </strong>
                        {typeof it.score === "number" && it.score != null && (
                          <Badge tone={it.score >= 0.6 ? "success" : "info"}>
                            {(it.score * 100).toFixed(0)}%
                          </Badge>
                        )}
                      </span>
                      {it.display_id && (
                        <span
                          className="rb-mono rb-tiny muted-text mb-8"
                          style={{ display: "block" }}
                        >
                          {it.display_id}
                        </span>
                      )}
                      {it.image_keys[0] ? (
                        <FoundImage
                          imageKey={it.image_keys[0]}
                          variant="thumb"
                          alt=""
                          className="thumb mb-8"
                        />
                      ) : (
                        <span className="thumb thumb--empty mb-8">画像なし</span>
                      )}
                      <span className="rb-row mb-8" style={{ gap: 6 }}>
                        <Badge>{STATUS_LABEL[it.status]}</Badge>
                        <span className="rb-tiny muted-text">
                          拾得場所: {it.found_location || "—"}
                        </span>
                      </span>
                      <span className="rb-small" style={{ display: "block" }}>
                        {it.ai_description.slice(0, 80)}
                      </span>
                    </BaseButton>
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
            <Button variant="outline" onClick={() => setInqOpen(false)}>
              キャンセル
            </Button>
            <Button onClick={registerInquiry} disabled={inqBusy}>
              {inqBusy ? "登録中" : "登録"}
            </Button>
          </>
        }
      >
        <p className="rb-small">
          探し物の特徴を未解決として保存します。<strong>個人情報は入力しないでください</strong>。
          連絡先等は紙台帳で管理し、ここには受付番号のみ記録します。
        </p>
        <Field label="受付番号（紙台帳）">
          {(id) => (
            <Input
              id={id}
              value={inqRef}
              onChange={(e) => setInqRef(e.target.value)}
              placeholder="R-1004"
            />
          )}
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
