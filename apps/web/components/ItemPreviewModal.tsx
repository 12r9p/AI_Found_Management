"use client";
import { Badge, Button, Card, Modal } from "./ui";
import { MapPicker } from "./MapPicker";
import { imageUrl } from "../lib/api";
import { STATUS_LABEL, type Item } from "../lib/types";

/**
 * 物品のクイックプレビュー。
 * 一覧から編集ポップアップへ直接飛ぶと文脈を失うため、まずここで中身を確認し、
 * 本当に編集する時だけ編集ポップアップ（ItemEditModal）を重ねて開く（ページ遷移はしない）。
 */
export function ItemPreviewModal({
  item,
  context,
  onClose,
  onEdit,
}: {
  item: Item | null;
  context: string;
  onClose: () => void;
  onEdit: (item: Item) => void;
}) {
  if (!item) return null;

  return (
    <Modal
      open={!!item}
      title={[item.color, item.brand, item.category].filter(Boolean).join(" ") || "物品"}
      context={context}
      size="wide"
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            閉じる
          </Button>
          <Button onClick={() => onEdit(item)}>編集する →</Button>
        </>
      }
    >
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

          {item.found_x != null && item.found_y != null && (
            <div className="mt-16">
              <div className="rb-label mb-8">拾得場所</div>
              <MapPicker value={{ x: item.found_x, y: item.found_y }} readOnly />
            </div>
          )}
        </div>

        <div>
          <div className="rb-between mb-8">
            <span className="rb-eyebrow">状態</span>
            <Badge tone={item.status === "stored" ? "success" : "info"}>
              {STATUS_LABEL[item.status]}
            </Badge>
          </div>
          <Card variant="muted">
            <div className="rb-small rb-mono">
              種別: {item.category || "—"}
              <br />
              色: {item.color || "—"}
              <br />
              ブランド: {item.brand || "—"}
              <br />
              拾得場所: {item.found_location || "—"}
              <br />
              拾得日時: {item.found_at ? new Date(item.found_at).toLocaleString("ja-JP") : "—"}
            </div>
          </Card>

          <div className="rb-label mt-16 mb-8">AI特徴文</div>
          <p className="rb-small" style={{ margin: 0 }}>
            {item.ai_description || "—"}
          </p>

          {item.tags.length > 0 && (
            <>
              <div className="rb-label mt-16 mb-8">タグ</div>
              <div className="rb-chips">
                {item.tags.map((t) => (
                  <span key={t} className="rb-chip">
                    {t}
                  </span>
                ))}
              </div>
            </>
          )}

          {item.notes && (
            <>
              <div className="rb-label mt-16 mb-8">メモ</div>
              <p className="rb-small" style={{ margin: 0 }}>
                {item.notes}
              </p>
            </>
          )}

          <div className="rb-tiny muted-text mt-16">
            登録: {new Date(item.created_at).toLocaleString("ja-JP")}
          </div>
        </div>
      </div>
    </Modal>
  );
}
