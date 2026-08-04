"use client";
import { useCallback, useEffect, useState } from "react";
import { AppShell } from "../../components/AppShell";
import { Badge, Button, Card, Select, Field } from "../../components/ui";
import { MatchReviewModal } from "../../components/MatchReviewModal";
import { FoundImage } from "../../components/FoundImage";
import { usePersistentState } from "../../components/usePersistentState";
import { api } from "../../lib/api";
import { STATUS_LABEL, type Match } from "../../lib/types";

const FILTERS = [
  { id: "pending", label: "確認待ち" },
  { id: "confirmed", label: "一致確定" },
  { id: "rejected", label: "不一致" },
  { id: "", label: "すべて" },
];

/**
 * 照合画面。「探す」と同じ階層に置き、突き合わせ作業を管理コンソールから独立させる。
 * 一覧はカード、判断はポップアップ（階層を明示）。
 */
export default function MatchesPage() {
  const [status, setStatus] = usePersistentState("matches:status", "pending");
  const [matches, setMatches] = useState<Match[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Match | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    api
      .listMatches(status || undefined)
      .then(setMatches)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [status]);

  useEffect(() => {
    load();
  }, [load]);

  // 通知などから ?open=<matchId> で直接ダイアログを開く。
  // 現在の表示フィルタ（status）に一致しない場合でも開けるよう、絞り込みなしで別途取得する。
  useEffect(() => {
    const id = new URLSearchParams(location.search).get("open");
    if (!id) return;
    api
      .listMatches()
      .then((all) => {
        const m = all.find((x) => x.id === id);
        if (m) setSelected(m);
      })
      .catch(() => {})
      .finally(() => history.replaceState(null, "", "/matches"));
  }, []);

  const pendingCount = matches.filter((m) => m.status === "pending").length;

  return (
    <AppShell>
      <div className="rb-between mb-16">
        <div>
          <h2>問い合わせとの突き合わせ</h2>
        </div>
        <Button variant="outline" size="sm" onClick={load}>
          再読込
        </Button>
      </div>

      <Card variant="bordered" className="mb-16">
        <Field label="表示する状態">
          {(id) => (
            <Select id={id} value={status} onChange={(e) => setStatus(e.target.value)}>
              {FILTERS.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </Card>

      {loading && (
        <output className="rb-busy" aria-live="polite">
          <span className="rb-spinner" aria-hidden />
          <span>読み込み中…</span>
        </output>
      )}

      {!loading && matches.length === 0 && (
        <Card variant="muted">
          <p className="rb-small" style={{ margin: 0 }}>
            {status === "pending"
              ? "確認待ちの突き合わせはありません。新しい遺失物が登録され、未解決の問い合わせと一致するとここに表示されます。"
              : "該当する突き合わせはありません。"}
          </p>
        </Card>
      )}

      {!loading && matches.length > 0 && (
        <>
          {status === "pending" && (
            <div className="rb-eyebrow mb-8">{pendingCount}件が確認待ちです</div>
          )}
          <div className="rb-col">
            {matches.map((m) => {
              const pct = Math.round(m.score * 100);
              return (
                <button key={m.id} className="rb-listrow" onClick={() => setSelected(m)}>
                  <div className="rb-thumbs">
                    {m.item?.image_keys?.[0] ? (
                      <FoundImage
                        imageKey={m.item.image_keys[0]}
                        variant="thumb"
                        alt=""
                        className="rb-thumb-sm"
                      />
                    ) : (
                      <span className="rb-thumb-sm rb-thumb-sm--empty">無</span>
                    )}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="rb-between mb-8">
                      <strong>
                        {[m.item?.color, m.item?.brand, m.item?.category]
                          .filter(Boolean)
                          .join(" ") || "物品"}
                        <span className="muted-text">　↔　</span>
                        受付No: {m.inquiry?.reference_no || "—"}
                      </strong>
                      <span className="rb-row" style={{ gap: 6 }}>
                        <Badge tone={pct >= 60 ? "success" : "warning"}>{pct}%</Badge>
                        <Badge>{STATUS_LABEL[m.status]}</Badge>
                      </span>
                    </div>
                    <div className="rb-score mb-8" aria-hidden>
                      <div className="rb-score__bar" style={{ width: `${pct}%` }} />
                    </div>
                    <div className="rb-small muted-text">
                      {(m.inquiry?.description || "").slice(0, 90) || "—"}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </>
      )}

      <MatchReviewModal
        match={selected}
        context="照合"
        onClose={() => setSelected(null)}
        onDecided={load}
      />
    </AppShell>
  );
}
