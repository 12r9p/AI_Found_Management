"use client";
import { Badge, Button, Card, Modal, useToast } from "./ui";
import { MapPicker } from "./MapPicker";
import { api, imageUrl, isAppliedApiError } from "../lib/api";
import { STATUS_LABEL, type Item } from "../lib/types";
import { useState } from "react";

/**
 * 受付での照会ポップアップ。
 * 窓口で「これですか?」と見せ、そのまま返却処理まで完結させる画面。
 * 編集は別ボタン（誤操作で編集画面に入らないよう一段挟む）。
 */
export function ItemLookupModal({
  item,
  context,
  onClose,
  onReturned,
  onEdit,
}: {
  item: Item | null;
  context: string;
  onClose: () => void;
  /** 返却処理が完了した後（一覧の再読込などに使う） */
  onReturned: (item: Item, prevStatus: Item["status"]) => void;
  onEdit: (item: Item) => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  if (!item) return null;

  const markReturned = async () => {
    setBusy(true);
    const prev = item.status;
    try {
      await api.updateItem(item.id, { status: "returned" });
      onReturned(item, prev);
      onClose();
    } catch (e) {
      if (isAppliedApiError(e)) {
        const updated = await api
          .getItem(item.id)
          .then((result) => result.item)
          .catch(() => ({ ...item, status: "returned" }) as Item);
        toast("返却処理は反映済みです。検索データの同期は保留中です", "success");
        onReturned(updated, prev);
        onClose();
        return;
      }
      toast(`更新に失敗しました: ${(e as Error).message}`, "error");
    } finally {
      setBusy(false);
    }
  };

  const already = item.status !== "stored";

  return (
    <Modal
      open={!!item}
      title={`照会: ${[item.color, item.brand, item.category].filter(Boolean).join(" ") || "物品"}`}
      context={context}
      size="wide"
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            閉じる
          </Button>
          <Button variant="outline" onClick={() => onEdit(item)} disabled={busy}>
            編集
          </Button>
          <Button onClick={markReturned} disabled={busy || already}>
            {already ? STATUS_LABEL[item.status] : busy ? "処理中…" : "返却済みにする"}
          </Button>
        </>
      }
    >
      <div className="rb-between mb-16">
        <span className="rb-idtag">{item.display_id || item.id.slice(0, 8)}</span>
        <Badge tone={item.status === "stored" ? "success" : "info"}>
          {STATUS_LABEL[item.status]}
        </Badge>
      </div>

      <div className="rb-grid rb-grid--2">
        <div>
          {item.image_keys.length > 0 ? (
            <div className="rb-grid rb-grid--2">
              {item.image_keys.map((k) => (
                <a key={k} href={imageUrl(k)} target="_blank" rel="noreferrer">
                  <img src={imageUrl(k)} alt="拾得物" className="thumb" />
                </a>
              ))}
            </div>
          ) : (
            <div className="thumb thumb--empty">画像なし</div>
          )}
        </div>

        <div>
          {/* 窓口での本人確認に使う情報を大きめに並べる */}
          <Card variant="muted">
            <div className="rb-label mb-8">特徴</div>
            <p className="rb-small" style={{ margin: 0 }}>
              {item.ai_description || "—"}
            </p>
            {item.tags.length > 0 && (
              <div className="rb-chips mt-16">
                {item.tags.map((t) => (
                  <span key={t} className="rb-chip">
                    {t}
                  </span>
                ))}
              </div>
            )}
          </Card>

          <Card variant="muted" className="mt-16">
            <div className="rb-small rb-mono">
              保管場所: {item.storage_location || "—"}
              <br />
              拾得場所: {item.found_location || "—"}
              <br />
              拾得日時: {item.found_at ? new Date(item.found_at).toLocaleString("ja-JP") : "—"}
              <br />
              登録日時: {new Date(item.created_at).toLocaleString("ja-JP")}
            </div>
          </Card>

          {item.found_x != null && item.found_y != null && (
            <div className="mt-16">
              <div className="rb-label mb-8">拾得場所</div>
              <MapPicker value={{ x: item.found_x, y: item.found_y }} readOnly />
            </div>
          )}
        </div>
      </div>

      {already && (
        <p className="rb-tiny muted-text mt-16" style={{ marginBottom: 0 }}>
          この物品は既に「{STATUS_LABEL[item.status]}
          」です。状態を戻す場合は編集から変更してください。
        </p>
      )}
    </Modal>
  );
}
