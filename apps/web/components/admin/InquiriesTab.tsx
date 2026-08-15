"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Badge, Button, Card, Field, Select, useToast } from "../ui";
import { FoundImage } from "../FoundImage";
import { usePersistentState } from "../usePersistentState";
import { api, itemCursorsEqual, type ItemCursor } from "../../lib/api";
import { STATUS_LABEL, type Inquiry } from "../../lib/types";

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
 * 一覧から固定URLの詳細画面へ移動し、照合と編集を独立した画面で行う。
 */
export function InquiriesTab() {
  const toast = useToast();
  const [status, setStatus] = usePersistentState("admin:inqStatus", "");
  const [inquiries, setInquiries] = useState<Inquiry[]>([]);
  const [loading, setLoading] = useState(true);
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
              <Link key={inq.id} className="rb-listrow" href={`/admin/inquiries/${inq.id}`}>
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
              </Link>
            );
          })}
        </>
      )}
    </div>
  );
}
