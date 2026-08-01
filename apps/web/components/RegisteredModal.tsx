"use client";
import { Badge, Button, Card, Modal } from "./ui";
import { MapPicker } from "./MapPicker";
import { imageUrl } from "../lib/api";
import { STATUS_LABEL, type Item } from "../lib/types";

/**
 * 登録直後の確認ポップアップ。管理番号を表示して紙タグに記入・貼り付けるための画面。
 * AI解析はバックグラウンドで動くためこの時点では一致判定は出ない
 * （一致すれば後で通知ベルに届く）。「閉じる」だけで次の登録に進める。
 */
export function RegisteredModal({
  item,
  onClose,
  onContinue,
  onEdit,
}: {
  item: Item | null;
  onClose: () => void;
  onContinue: () => void;
  onEdit: (item: Item) => void;
}) {
  if (!item) return null;

  return (
    <Modal
      open={!!item}
      title="登録完了"
      context="登録"
      size="wide"
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={() => onEdit(item)}>
            編集
          </Button>
          <Button variant="outline" onClick={onClose}>
            閉じる
          </Button>
          <Button onClick={onContinue}>同じ属性で続けて登録</Button>
        </>
      }
    >
      <div className="rb-between mb-16">
        <span className="rb-idtag">{item.display_id || item.id.slice(0, 8)}</span>
        <Badge tone="success">{STATUS_LABEL[item.status]}</Badge>
      </div>

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
              拾得日時:{" "}
              <strong>
                {item.found_at ? new Date(item.found_at).toLocaleString("ja-JP") : "—"}
              </strong>
            </div>
          </Card>
          {item.notes && (
            <>
              <div className="rb-label mt-16 mb-8">メモ</div>
              <p className="rb-small" style={{ margin: 0 }}>
                {item.notes}
              </p>
            </>
          )}
          <div className="rb-between mt-16 mb-8">
            <span className="rb-label" style={{ margin: 0 }}>
              特徴
            </span>
            {item.ai_status === "pending" && <Badge tone="warning">解析中</Badge>}
          </div>
          {item.ai_status !== "pending" && (
            <>
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
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
