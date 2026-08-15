"use client";
import { Button as BaseButton } from "@base-ui/react/button";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Badge,
  Button,
  Card,
  Field,
  Input,
  Modal,
  Select,
  Textarea,
  useToast,
  useConfirm,
  MetaOptionList,
} from "../ui";
import { MatchReviewModal } from "../MatchReviewModal";
import { FoundImage } from "../FoundImage";
import { useMeta } from "../useMeta";
import { usePersistentState } from "../usePersistentState";
import { api, isAppliedApiError, itemCursorsEqual, type ItemCursor } from "../../lib/api";
import { STATUS_LABEL, type Inquiry, type Match } from "../../lib/types";

const STATUS_FILTERS = [
  { id: "", label: "すべて" },
  { id: "open", label: "未解決" },
  { id: "matched", label: "候補あり" },
  { id: "contacted", label: "連絡済" },
  { id: "resolved", label: "解決" },
  { id: "closed", label: "取下げ" },
];

interface RematchProgress {
  runId: string;
  itemsChecked: number;
  matchesFound: number;
  failed: number;
  resumeCursor: ItemCursor | null;
  done: boolean;
  interrupted: boolean;
}

/**
 * 管理 > 問い合わせ。
 * 一覧行をクリックで詳細ポップアップ（照合候補を画像付きで表示）。
 * 候補をさらにクリックすると突き合わせ確認ダイアログへ重なる。
 */
export function InquiriesTab() {
  const toast = useToast();
  const [status, setStatus] = usePersistentState("admin:inqStatus", "");
  const [inquiries, setInquiries] = useState<Inquiry[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Inquiry | null>(null);
  const [rematching, setRematching] = useState(false);
  const [importing, setImporting] = useState(false);
  const importFileRef = useRef<HTMLInputElement>(null);
  const [rematchProgress, setRematchProgress] = useState<RematchProgress | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    api
      .listInquiries(status || undefined, true)
      .then(setInquiries)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [status]);

  useEffect(() => {
    load();
  }, [load]);

  /** 保管中の物品を100件ずつ順に処理し、通信が途切れた場合は最後に完了した
   * カーソルと累積件数を残して同じ位置から再開できるようにする。 */
  const runRematch = async (resume: boolean) => {
    const previous = resume ? rematchProgress : null;
    const runId = previous?.runId ?? crypto.randomUUID();
    const totals = {
      itemsChecked: previous?.itemsChecked ?? 0,
      matchesFound: previous?.matchesFound ?? 0,
      failed: previous?.failed ?? 0,
    };
    let cursor = previous?.resumeCursor ?? null;
    setRematching(true);
    setRematchProgress({
      ...totals,
      runId,
      resumeCursor: cursor,
      done: false,
      interrupted: false,
    });
    try {
      for (;;) {
        const requestedCursor = cursor;
        const page = await api.rematchPage(cursor ?? undefined, runId);
        totals.itemsChecked += page.itemsChecked;
        totals.matchesFound += page.matchesFound;
        totals.failed += page.failed;
        cursor = page.nextCursor;
        setRematchProgress({
          ...totals,
          runId,
          resumeCursor: cursor,
          done: page.done,
          interrupted: false,
        });
        if (page.done) {
          // キャッシュ削除に失敗しても、再照合自体は成功扱いにする。TTLで回収される。
          await api.finishRematch(runId).catch(() => {});
          break;
        }
        if (!cursor || itemCursorsEqual(cursor, requestedCursor)) {
          throw new Error("rematch_pagination_stalled");
        }
      }
      const failedNote = totals.failed > 0 ? `(${totals.failed}件は失敗)` : "";
      toast(
        totals.matchesFound > 0
          ? `${totals.itemsChecked}件を再照合し、新たに${totals.matchesFound}件の一致候補が見つかりました${failedNote}`
          : `${totals.itemsChecked}件を再照合しましたが、新たな一致はありませんでした${failedNote}`,
        totals.failed > 0 && totals.failed === totals.itemsChecked ? "error" : "success",
      );
      load();
    } catch (e) {
      setRematchProgress({
        ...totals,
        runId,
        resumeCursor: cursor,
        done: false,
        interrupted: true,
      });
      toast(
        `再照合が${totals.itemsChecked}件で中断しました。続きから再開できます: ${(e as Error).message}`,
        "error",
      );
    } finally {
      setRematching(false);
    }
  };

  // 選択中の問い合わせを最新に保つ（判断後にダイアログの中身も更新）
  const current = selected ? (inquiries.find((i) => i.id === selected.id) ?? selected) : null;

  const importCsv = async (file: File | undefined) => {
    if (!file) return;
    setImporting(true);
    try {
      const result = await api.importInquiries(file);
      const details = [
        `${result.imported}件取込`,
        result.skipped ? `${result.skipped}件重複` : "",
        result.failed ? `${result.failed}件失敗` : "",
        result.warnings.length ? `${result.warnings.length}件要確認` : "",
        result.matchesCreated ? `${result.matchesCreated}件候補作成` : "",
      ].filter(Boolean);
      toast(details.join("・"), result.failed || result.warnings.length ? "error" : "success");
      load();
    } catch (error) {
      toast(`CSV取込に失敗しました: ${(error as Error).message}`, "error");
    } finally {
      setImporting(false);
      if (importFileRef.current) importFileRef.current.value = "";
    }
  };

  return (
    <div className="rb-col">
      <Card variant="bordered" className="no-print">
        <div className="rb-grid rb-grid--2">
          <Field label="状態で絞込">
            {(id) => (
              <Select id={id} value={status} onChange={(e) => setStatus(e.target.value)}>
                {STATUS_FILTERS.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <div className="rb-field" style={{ justifyContent: "flex-end" }}>
            <div className="rb-row" style={{ gap: 8 }}>
              <Button variant="outline" onClick={load}>
                再読込
              </Button>
              <Button
                variant="outline"
                onClick={() => importFileRef.current?.click()}
                disabled={importing || rematching}
              >
                {importing ? "CSV取込中…" : "CSV取込"}
              </Button>
              <input
                ref={importFileRef}
                type="file"
                accept=".csv,text/csv"
                hidden
                onChange={(event) => importCsv(event.target.files?.[0])}
              />
              <Button variant="outline" onClick={() => runRematch(false)} disabled={rematching}>
                {rematching ? "再照合中…" : "全件再照合"}
              </Button>
            </div>
          </div>
        </div>
        {rematchProgress && (
          <output className="rb-between mt-8" aria-live="polite">
            <span className="rb-tiny muted-text">
              {rematchProgress.done
                ? "再照合完了"
                : rematchProgress.interrupted
                  ? "再照合中断"
                  : "再照合中"}
              : {rematchProgress.itemsChecked}件確認・{rematchProgress.matchesFound}件一致・
              {rematchProgress.failed}件失敗
            </span>
            {rematchProgress.interrupted && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => runRematch(true)}
                disabled={rematching}
              >
                続きから再開
              </Button>
            )}
          </output>
        )}
        <p className="rb-tiny muted-text" style={{ margin: 0 }}>
          行をクリックすると詳細と照合候補を確認できます。個人情報は紙台帳（受付No）で管理します。
          CSVは「落とし物の特徴」列が必須で、カテゴリ・色・受付番号・タグ・備考を任意で取り込めます。
        </p>
      </Card>

      {loading && (
        <output className="rb-busy" aria-live="polite">
          <span className="rb-spinner" aria-hidden />
          <span>読み込み中…</span>
        </output>
      )}

      {!loading && inquiries.length === 0 && (
        <Card variant="muted">
          <p className="rb-small" style={{ margin: 0 }}>
            問い合わせはありません。「探す」画面で該当なしのとき「未解決で登録」すると追加されます。
          </p>
        </Card>
      )}

      {!loading && inquiries.length > 0 && (
        <>
          <div className="rb-eyebrow">{inquiries.length}件</div>
          {inquiries.map((inq) => {
            const cands = inq.matches ?? [];
            return (
              <button key={inq.id} className="rb-listrow" onClick={() => setSelected(inq)}>
                {/* 照合候補の画像を一覧段階で見せる（開かずに当たりを付けられる） */}
                <div className="rb-thumbs">
                  {cands.slice(0, 2).map((m) =>
                    m.item?.image_keys?.[0] ? (
                      <FoundImage
                        key={m.id}
                        imageKey={m.item.image_keys[0]}
                        variant="thumb"
                        alt=""
                        className="rb-thumb-sm"
                      />
                    ) : (
                      <span key={m.id} className="rb-thumb-sm rb-thumb-sm--empty">
                        無
                      </span>
                    ),
                  )}
                  {cands.length === 0 && <span className="rb-thumb-sm rb-thumb-sm--empty">—</span>}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <span className="rb-between mb-8">
                    <strong>
                      受付No: {inq.reference_no || "—"}
                      <span className="muted-text">　/　</span>
                      {[inq.color, inq.category].filter(Boolean).join(" ") || "種別未設定"}
                    </strong>
                    <span className="rb-row" style={{ gap: 6 }}>
                      {cands.length > 0 && <Badge tone="info">候補 {cands.length}</Badge>}
                      <Badge
                        tone={
                          inq.status === "resolved"
                            ? "success"
                            : inq.status === "contacted"
                              ? "info"
                              : inq.status === "open"
                                ? "warning"
                                : undefined
                        }
                      >
                        {STATUS_LABEL[inq.status]}
                      </Badge>
                    </span>
                  </span>
                  <div className="rb-small muted-text">{inq.description.slice(0, 100) || "—"}</div>
                  <div className="rb-tiny muted-text mt-8">
                    受付: {new Date(inq.created_at).toLocaleString("ja-JP")}
                  </div>
                </div>
              </button>
            );
          })}
        </>
      )}

      <InquiryDetailModal inquiry={current} onClose={() => setSelected(null)} onChanged={load} />
    </div>
  );
}

/** 問い合わせ詳細＋照合候補（画像付き）。編集もここで行う。 */
function InquiryDetailModal({
  inquiry,
  onClose,
  onChanged,
}: {
  inquiry: Inquiry | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const meta = useMeta();
  const toast = useToast();
  const confirm = useConfirm();
  const [edit, setEdit] = useState(false);
  const [form, setForm] = useState<Partial<Inquiry>>({});
  const [saving, setSaving] = useState(false);
  const [reviewing, setReviewing] = useState<Match | null>(null);

  useEffect(() => {
    if (inquiry) {
      setForm({ ...inquiry });
      setEdit(false);
    }
  }, [inquiry?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!inquiry) return null;
  const cands = inquiry.matches ?? [];

  const save = async () => {
    setSaving(true);
    try {
      await api.updateInquiry(inquiry.id, {
        status: form.status,
        category: form.category,
        color: form.color,
        description: form.description,
        reference_no: form.reference_no,
        notes: form.notes,
      });
      toast("保存しました", "success");
      setEdit(false);
      onChanged();
    } catch (e) {
      if (isAppliedApiError(e)) {
        toast("保存内容は反映済みです。検索データの同期は保留中です", "success");
        setEdit(false);
        onChanged();
        return;
      }
      toast(`保存に失敗しました: ${(e as Error).message}`, "error");
    } finally {
      setSaving(false);
    }
  };

  const del = async () => {
    const ok = await confirm({
      title: "問い合わせの削除",
      body: `受付No: ${inquiry.reference_no || "—"} の問い合わせを削除します。元に戻せません。`,
      danger: true,
      okLabel: "削除する",
    });
    if (!ok) return;
    await api.deleteInquiry(inquiry.id);
    toast("削除しました", "success");
    onChanged();
    onClose();
  };

  const rejectCandidate = async (match: Match) => {
    const ok = await confirm({
      title: "不一致の確認",
      body: "この候補を不一致として処理します。以後、この組み合わせでは通知されません。",
      danger: true,
      okLabel: "不一致にする",
    });
    if (!ok) return;

    setSaving(true);
    try {
      await api.updateMatch(match.id, "rejected");
      if (reviewing?.id === match.id) setReviewing(null);
      toast("候補を不一致として処理しました", "success");
      onChanged();
    } catch (e) {
      if (isAppliedApiError(e)) {
        if (reviewing?.id === match.id) setReviewing(null);
        toast("不一致の判断は反映済みです。検索データの同期は保留中です", "success");
        onChanged();
        return;
      }
      toast(`更新に失敗しました: ${(e as Error).message}`, "error");
    } finally {
      setSaving(false);
    }
  };

  const rejectAllCandidates = async () => {
    const pendingCount = cands.filter((match) => match.status === "pending").length;
    if (!pendingCount) return;

    const ok = await confirm({
      title: "全候補を不一致にする",
      body: `確認待ちの候補 ${pendingCount} 件をすべて不一致として処理します。以後、これらの組み合わせでは通知されません。`,
      danger: true,
      okLabel: `${pendingCount}件を不一致にする`,
    });
    if (!ok) return;

    setSaving(true);
    try {
      const { rejected } = await api.rejectPendingMatches(inquiry.id);
      if (reviewing) setReviewing(null);
      toast(`${rejected}件の候補を不一致として処理しました`, "success");
      onChanged();
    } catch (e) {
      if (isAppliedApiError(e)) {
        if (reviewing) setReviewing(null);
        toast("不一致の判断は反映済みです。検索データの同期は保留中です", "success");
        onChanged();
        return;
      }
      toast(`更新に失敗しました: ${(e as Error).message}`, "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Modal
        open={!!inquiry && !reviewing}
        title={`問い合わせ 受付No: ${inquiry.reference_no || "—"}`}
        context="管理 › 問い合わせ"
        size="wide"
        onClose={onClose}
        footer={
          edit ? (
            <>
              <Button
                variant="outline"
                onClick={() => {
                  setForm({ ...inquiry });
                  setEdit(false);
                }}
                disabled={saving}
              >
                取消
              </Button>
              <Button onClick={save} disabled={saving}>
                {saving ? "保存中…" : "保存"}
              </Button>
            </>
          ) : (
            <>
              <Button variant="destructive" onClick={del}>
                削除
              </Button>
              <Button variant="outline" onClick={() => setEdit(true)}>
                編集
              </Button>
              <Button onClick={onClose}>閉じる</Button>
            </>
          )
        }
      >
        {!edit ? (
          <Card variant="muted" className="mb-16">
            <div className="rb-between mb-8">
              <strong>
                {[inquiry.color, inquiry.category].filter(Boolean).join(" ") || "種別未設定"}
              </strong>
              <Badge
                tone={
                  inquiry.status === "resolved"
                    ? "success"
                    : inquiry.status === "contacted"
                      ? "info"
                      : inquiry.status === "open"
                        ? "warning"
                        : undefined
                }
              >
                {STATUS_LABEL[inquiry.status]}
              </Badge>
            </div>
            <div className="rb-label mb-8">聞き取り内容</div>
            <p className="rb-small" style={{ margin: 0 }}>
              {inquiry.description || "—"}
            </p>
            {inquiry.notes && (
              <>
                <div className="rb-label mt-16 mb-8">メモ</div>
                <p className="rb-small" style={{ margin: 0 }}>
                  {inquiry.notes}
                </p>
              </>
            )}
            <div className="rb-tiny muted-text mt-16">
              受付: {new Date(inquiry.created_at).toLocaleString("ja-JP")} / 更新:{" "}
              {new Date(inquiry.updated_at).toLocaleString("ja-JP")}
            </div>
          </Card>
        ) : (
          <Card variant="bordered" className="mb-16">
            <div className="rb-grid rb-grid--2">
              <Field label="受付番号（紙台帳）">
                {(id) => (
                  <Input
                    id={id}
                    value={form.reference_no ?? ""}
                    onChange={(e) => setForm((f) => ({ ...f, reference_no: e.target.value }))}
                  />
                )}
              </Field>
              <Field label="状態">
                {(id) => (
                  <Select
                    id={id}
                    value={form.status}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, status: e.target.value as Inquiry["status"] }))
                    }
                  >
                    {meta.inquiryStatuses.map((s) => (
                      <option key={s} value={s}>
                        {STATUS_LABEL[s]}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label="種別">
                {(id) => (
                  <Select
                    id={id}
                    value={form.category}
                    onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                  >
                    <option value="">未設定</option>
                    <MetaOptionList options={meta.categories} />
                  </Select>
                )}
              </Field>
              <Field label="色">
                {(id) => (
                  <Select
                    id={id}
                    value={form.color}
                    onChange={(e) => setForm((f) => ({ ...f, color: e.target.value }))}
                  >
                    <option value="">未設定</option>
                    <MetaOptionList options={meta.colors} />
                  </Select>
                )}
              </Field>
            </div>
            <div className="rb-tiny muted-text">
              種別・色は特徴文から自動設定される場合があります。内容を確認し、必要なら修正してください。修正後は再照合されます。
            </div>
            <Field label="聞き取り内容" hint="保存すると再ベクトル化され、以後の照合に反映されます">
              {(id) => (
                <Textarea
                  id={id}
                  value={form.description ?? ""}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                />
              )}
            </Field>
            <Field label="メモ" hint="個人情報は入力しないでください">
              {(id) => (
                <Textarea
                  id={id}
                  value={form.notes ?? ""}
                  onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                />
              )}
            </Field>
          </Card>
        )}

        <div className="rb-between mb-8">
          <div className="rb-label">照合候補（{cands.length}件）</div>
          {cands.some((match) => match.status === "pending") && (
            <Button variant="destructive" size="sm" onClick={rejectAllCandidates} disabled={saving}>
              全候補を不一致
            </Button>
          )}
        </div>
        {cands.length === 0 ? (
          <Card variant="muted">
            <p className="rb-small" style={{ margin: 0 }}>
              一致する候補はまだありません。新しい遺失物が登録されると自動で照合され、
              候補が見つかればスタッフに通知されます。
            </p>
          </Card>
        ) : (
          <div className="rb-grid rb-grid--auto">
            {cands.map((m) => {
              const pct = Math.round(m.score * 100);
              return (
                <div key={m.id} className="rb-card">
                  <BaseButton
                    className="rb-card--interactive rb-interactive-card"
                    onClick={() => setReviewing({ ...m, inquiry })}
                    aria-label={`${[m.item?.color, m.item?.category].filter(Boolean).join(" ") || "物品"}の照合候補を確認`}
                  >
                    <span className="rb-between mb-8">
                      <strong className="rb-small">
                        {[m.item?.color, m.item?.category].filter(Boolean).join(" ") || "物品"}
                      </strong>
                      <Badge tone={pct >= 60 ? "success" : "warning"}>{pct}%</Badge>
                    </span>
                    {m.item?.image_keys?.[0] ? (
                      <FoundImage
                        imageKey={m.item.image_keys[0]}
                        variant="preview"
                        alt=""
                        className="thumb mb-8"
                      />
                    ) : (
                      <span className="thumb thumb--empty mb-8">画像なし</span>
                    )}
                    <span className="rb-tiny muted-text" style={{ display: "block" }}>
                      拾得場所: {m.item?.found_location || "—"} / {STATUS_LABEL[m.status]}
                    </span>
                  </BaseButton>
                  {m.status === "pending" && (
                    <Button
                      variant="destructive"
                      size="sm"
                      className="mt-8"
                      onClick={() => rejectCandidate(m)}
                      disabled={saving}
                    >
                      不一致
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Modal>

      {/* 候補 → 突き合わせ確認（さらに一段深い階層） */}
      <MatchReviewModal
        match={reviewing}
        context="管理 › 問い合わせ › 候補"
        onClose={() => setReviewing(null)}
        onDecided={onChanged}
      />
    </>
  );
}
