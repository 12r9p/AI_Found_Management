"use client";
import { Button as BaseButton } from "@base-ui/react/button";
import { useEffect, useState } from "react";
import { imageUrl } from "../lib/api";
import { STATUS_LABEL, type Item, type Meta } from "../lib/types";
import { Badge, Button, ColorSwatch } from "./ui";
import { ItemPreviewModal } from "./ItemPreviewModal";
import { ItemEditModal } from "./ItemEditModal";

const TEXT_COLS: {
  key: "category" | "color" | "brand" | "found_location" | "notes";
  label: string;
  w?: number;
}[] = [
  { key: "category", label: "種別", w: 96 },
  { key: "color", label: "色", w: 72 },
  { key: "brand", label: "ブランド", w: 110 },
  { key: "found_location", label: "拾得場所", w: 130 },
  { key: "notes", label: "メモ", w: 160 },
];

export function ItemsTable({
  items,
  meta,
  onChanged,
}: {
  items: Item[];
  meta: Meta;
  onChanged: () => void;
}) {
  const [rows, setRows] = useState<Item[]>(items);

  useEffect(() => {
    setRows(items);
  }, [items]);

  const [preview, setPreview] = useState<Item | null>(null);
  const [editing, setEditing] = useState<Item | null>(null);

  const onSaved = (updated: Item) => {
    setRows((rs) => rs.map((r) => (r.id === updated.id ? updated : r)));
    onChanged();
  };

  const onDeleted = (id: string) => {
    setRows((rs) => rs.filter((r) => r.id !== id));
    onChanged();
  };

  return (
    <div className="rb-table-wrap">
      <table className="rb-table">
        <thead>
          <tr>
            <th style={{ width: 92 }}>画像</th>
            <th style={{ width: 172 }}>管理番号</th>
            <th style={{ width: 96 }}>状態</th>
            {TEXT_COLS.map((c) => (
              <th key={c.key} style={{ width: c.w }}>
                {c.label}
              </th>
            ))}
            <th style={{ width: 150 }}>操作</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((it) => (
            <tr key={it.id}>
              <td>
                {/* 現物の識別が一番速いので画像を先頭に置く。クリックで詳細ポップアップ。 */}
                <div className="rb-cell-thumbs">
                  {it.image_keys.length > 0 ? (
                    it.image_keys.slice(0, 2).map((k, index) => (
                      <BaseButton
                        key={k}
                        className="rb-cell-thumb-button"
                        onClick={() => setPreview(it)}
                        aria-label={`${it.display_id || "物品"}の画像${index + 1}を表示`}
                      >
                        <img src={imageUrl(k)} alt="" className="rb-cell-thumb" />
                      </BaseButton>
                    ))
                  ) : (
                    <span className="rb-cell-thumb rb-cell-thumb--empty">無</span>
                  )}
                </div>
              </td>
              <td className="rb-mono rb-small">{it.display_id || "—"}</td>
              <td>
                <div className="rb-row" style={{ gap: 4 }}>
                  <Badge tone={it.status === "stored" ? "success" : "info"}>
                    {STATUS_LABEL[it.status]}
                  </Badge>
                  {it.ai_status === "pending" && <Badge tone="warning">AI解析中</Badge>}
                  {it.ai_status === "error" && <Badge tone="error">AI解析失敗</Badge>}
                </div>
              </td>
              {TEXT_COLS.map((c) => (
                <td key={c.key} className="rb-small" title={(it[c.key] as string) || undefined}>
                  {c.key === "color" && it.color ? (
                    <span className="rb-row" style={{ gap: 6 }}>
                      <ColorSwatch color={meta.colors.find((m) => m.name === it.color)?.color} />
                      {it.color}
                    </span>
                  ) : (
                    (it[c.key] as string) || "—"
                  )}
                </td>
              ))}
              <td>
                <div className="rb-row" style={{ gap: 4, padding: "0 6px", flexWrap: "nowrap" }}>
                  {/* 一覧では確認・編集ともポップアップで完結させ、行の高さや画面を崩さない。
                      削除は誤操作を避けるため一覧からは無くし、編集画面の中に置く。 */}
                  <Button variant="outline" size="sm" onClick={() => setPreview(it)}>
                    詳細
                  </Button>
                  <Button size="sm" onClick={() => setEditing(it)}>
                    編集
                  </Button>
                </div>
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={TEXT_COLS.length + 4} style={{ padding: 16, textAlign: "center" }}>
                データがありません
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <ItemPreviewModal
        item={preview}
        context="管理 › 物品一覧"
        onClose={() => setPreview(null)}
        onEdit={(it) => {
          setPreview(null);
          setEditing(it);
        }}
      />
      <ItemEditModal
        item={editing}
        context="管理 › 物品一覧"
        onClose={() => setEditing(null)}
        onSaved={onSaved}
        onDeleted={onDeleted}
      />
    </div>
  );
}
