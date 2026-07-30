"use client";
import { useRouter } from "next/navigation";
import { Badge, Button, Card, Modal } from "./ui";
import { MapPicker } from "./MapPicker";
import { imageUrl } from "../lib/api";
import { STATUS_LABEL, type Item, type Match } from "../lib/types";

/**
 * 登録直後の確認ポップアップ。
 * 現場では連続して何件も登録するため、既定の動線は「続けて登録」。
 * 一致候補が出た場合だけ照合への導線を目立たせる。
 */
export function RegisteredModal({
  result,
  onClose,
  onContinue,
}: {
  result: { item: Item; matches: Match[] } | null;
  onClose: () => void;
  onContinue: () => void;
}) {
  const router = useRouter();
  if (!result) return null;
  const { item, matches } = result;
  const top = matches.length ? Math.max(...matches.map((m) => m.score)) : 0;

  return (
    <Modal
      open={!!result}
      title="登録完了"
      context="登録"
      size="wide"
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>閉じる</Button>
          {matches.length > 0 && (
            <Button variant="outline" onClick={() => router.push("/matches")}>
              照合を確認 →
            </Button>
          )}
          {/* 既定動線: 黒塗り（primary）で最も押しやすく */}
          <Button onClick={onContinue}>続けて登録</Button>
        </>
      }
    >
      <div className="rb-between mb-16">
        <span className="rb-idtag">{item.display_id || item.id.slice(0, 8)}</span>
        <Badge tone="success">{STATUS_LABEL[item.status]}</Badge>
      </div>

      {matches.length > 0 && (
        <Card variant="elevated" className="mb-16">
          <div className="rb-eyebrow mb-8" style={{ color: "var(--warning)" }}>
            ⚠ 未解決の問い合わせと一致する可能性
          </div>
          <p className="rb-small" style={{ margin: 0 }}>
            {matches.length}件の候補が見つかりました（最大 {(top * 100).toFixed(0)}%）。
            スタッフに通知済みです。照合画面で確認してください。
          </p>
        </Card>
      )}

      <div className="rb-grid rb-grid--2">
        <div>
          {item.image_keys.length > 0 ? (
            <div className="rb-grid rb-grid--2">
              {item.image_keys.map((k) => (
                <img key={k} src={imageUrl(k)} alt="拾得物" className="thumb" />
              ))}
            </div>
          ) : (
            <div className="thumb thumb--empty">画像なし</div>
          )}
          {item.found_x != null && item.found_y != null && (
            <div className="mt-16">
              <div className="rb-label mb-8">拾得場所</div>
              <MapPicker value={{ x: item.found_x, y: item.found_y }} readOnly />
            </div>
          )}
        </div>

        <div>
          <Card variant="muted">
            <div className="rb-small rb-mono">
              種別: <strong>{item.category || "—"}</strong>
              <br />
              色: {item.color || "—"}
              <br />
              ブランド: {item.brand || "—"}
              <br />
              保管場所: <strong>{item.storage_location || "—"}</strong>
              <br />
              拾得場所: {item.found_location || "—"}
              <br />
              拾得日時: {item.found_at ? new Date(item.found_at).toLocaleString("ja-JP") : "—"}
            </div>
          </Card>
          <div className="rb-label mt-16 mb-8">特徴</div>
          <p className="rb-small" style={{ margin: 0 }}>{item.ai_description || "—"}</p>
          {item.tags.length > 0 && (
            <div className="rb-chips mt-16">
              {item.tags.map((t) => <span key={t} className="rb-chip">{t}</span>)}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
