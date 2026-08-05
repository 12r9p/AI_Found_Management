"use client";
import Link from "next/link";
import { useState } from "react";
import { Badge, Button, Card, Modal, useConfirm, useToast } from "./ui";
import { MapPicker } from "./MapPicker";
import { api, imageUrl, isAppliedApiError } from "../lib/api";
import { STATUS_LABEL, type Match } from "../lib/types";

/**
 * 突き合わせの確認ダイアログ。
 * 一覧の上にポップアップで重ねることで「一覧 › 確認」の階層を明示し、
 * 判断後は元の一覧へ戻る（画面遷移で文脈を失わせない）。
 */
export function MatchReviewModal({
  match,
  context,
  onClose,
  onDecided,
}: {
  match: Match | null;
  context: string;
  onClose: () => void;
  onDecided: () => void;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);

  if (!match) return null;
  const item = match.item;
  const inquiry = match.inquiry;
  const pct = Math.round(match.score * 100);

  const decide = async (status: "confirmed" | "rejected") => {
    const ok = await confirm({
      title: status === "confirmed" ? "一致の確定" : "不一致の確認",
      body:
        status === "confirmed"
          ? `この遺失物を受付No: ${inquiry?.reference_no || "—"} の問い合わせと一致として確定します。\n問い合わせは「連絡済」になります。`
          : `この組み合わせを不一致として処理します。\n以後この組み合わせでは通知されません。`,
      danger: status === "rejected",
      okLabel: status === "confirmed" ? "一致を確定" : "不一致にする",
    });
    if (!ok) return;
    setBusy(true);
    try {
      await api.updateMatch(match.id, status);
      toast(
        status === "confirmed"
          ? "一致を確定し、連絡済みに更新しました"
          : "不一致として処理しました",
        "success",
      );
      onDecided();
      onClose();
    } catch (e) {
      if (isAppliedApiError(e)) {
        toast(
          status === "confirmed"
            ? "一致の判断は反映済みです。検索データの同期は保留中です"
            : "不一致の判断は反映済みです。検索データの同期は保留中です",
          "success",
        );
        onDecided();
        onClose();
        return;
      }
      toast(`更新に失敗しました: ${(e as Error).message}`, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={!!match}
      title="突き合わせの確認"
      context={context}
      size="wide"
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            閉じる（判断しない）
          </Button>
          <Button variant="destructive" onClick={() => decide("rejected")} disabled={busy}>
            不一致
          </Button>
          <Button onClick={() => decide("confirmed")} disabled={busy}>
            一致を確定
          </Button>
        </>
      }
    >
      <div className="mb-16">
        <div className="rb-between mb-8">
          <strong className="rb-mono">類似度 {pct}%</strong>
          <Badge tone={pct >= 60 ? "success" : "warning"}>{STATUS_LABEL[match.status]}</Badge>
        </div>
        <div className="rb-score" aria-label={`類似度 ${pct}パーセント`}>
          <div className="rb-score__bar" style={{ width: `${pct}%` }} />
        </div>
        <p className="rb-tiny muted-text mt-8" style={{ margin: "8px 0 0" }}>
          AIが特徴文から算出した参考値です。最終判断は現物と聞き取り内容で行ってください。
        </p>
      </div>

      <div className="rb-compare">
        {/* 保管している現物 */}
        <Card variant="bordered">
          <div className="rb-eyebrow mb-8">保管中の遺失物</div>
          {item?.image_keys?.length ? (
            <div className="rb-grid rb-grid--2 mb-8">
              {item.image_keys.map((k) => (
                <a key={k} href={imageUrl(k)} target="_blank" rel="noreferrer">
                  <img src={imageUrl(k)} alt="遺失物" className="thumb" />
                </a>
              ))}
            </div>
          ) : (
            <p className="rb-tiny muted-text">画像なし</p>
          )}
          <div className="rb-small">
            <strong>
              {[item?.color, item?.brand, item?.category].filter(Boolean).join(" ") || "—"}
            </strong>
            <br />
            拾得場所: {item?.found_location || "—"}
            <br />
            拾得日時: {item?.found_at ? new Date(item.found_at).toLocaleString("ja-JP") : "—"}
          </div>
          <p className="rb-small muted-text mt-8">{item?.ai_description}</p>
          {item && item.found_x != null && item.found_y != null && (
            <div className="mt-8">
              <div className="rb-label mb-8">拾得場所</div>
              <MapPicker value={{ x: item.found_x, y: item.found_y }} readOnly />
            </div>
          )}
          {item && (
            <Link href={`/items/${item.id}`} className="rb-btn rb-btn--outline rb-btn--sm mt-16">
              編集ページを開く →
            </Link>
          )}
        </Card>

        <div className="rb-compare__vs" aria-hidden>
          対 照
        </div>

        {/* 問い合わせ（紙台帳の受付番号のみ） */}
        <Card variant="bordered">
          <div className="rb-eyebrow mb-8">
            問い合わせ（受付No: {inquiry?.reference_no || "—"}）
          </div>
          <div className="rb-small">
            <strong>{[inquiry?.color, inquiry?.category].filter(Boolean).join(" ") || "—"}</strong>
            <br />
            受付日時: {inquiry ? new Date(inquiry.created_at).toLocaleString("ja-JP") : "—"}
            <br />
            状態: {inquiry ? STATUS_LABEL[inquiry.status] : "—"}
          </div>
          <div className="rb-label mt-16 mb-8">聞き取り内容</div>
          <p className="rb-small" style={{ margin: 0 }}>
            {inquiry?.description || "—"}
          </p>
          {inquiry?.notes && (
            <>
              <div className="rb-label mt-16 mb-8">メモ</div>
              <p className="rb-small" style={{ margin: 0 }}>
                {inquiry.notes}
              </p>
            </>
          )}
          <p className="rb-tiny muted-text mt-16" style={{ marginBottom: 0 }}>
            ※ 連絡先などの個人情報は紙台帳で管理しています。受付Noで照会してください。
          </p>
        </Card>
      </div>
    </Modal>
  );
}
