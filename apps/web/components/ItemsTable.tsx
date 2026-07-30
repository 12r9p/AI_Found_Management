"use client";
import { useEffect, useRef, useState } from "react";
import { api, imageUrl } from "../lib/api";
import { STATUS_LABEL, type Item, type Meta } from "../lib/types";
import { Button, useToast, useConfirm } from "./ui";
import { ItemPreviewModal } from "./ItemPreviewModal";

type EditableField =
  | "display_id" | "status" | "category" | "color" | "brand"
  | "found_location" | "storage_location" | "notes";

const TEXT_COLS: { key: EditableField; label: string; w?: number }[] = [
  { key: "category", label: "種別", w: 96 },
  { key: "color", label: "色", w: 72 },
  { key: "brand", label: "ブランド", w: 110 },
  { key: "found_location", label: "拾得場所", w: 130 },
  { key: "storage_location", label: "保管場所", w: 110 },
  { key: "notes", label: "メモ", w: 160 },
];

export function ItemsTable({ items, meta, onChanged }: { items: Item[]; meta: Meta; onChanged: () => void }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [rows, setRows] = useState<Item[]>(items);
  const originals = useRef<Map<string, Item>>(new Map());

  useEffect(() => {
    setRows(items);
    originals.current = new Map(items.map((i) => [i.id, { ...i }]));
  }, [items]);

  const [preview, setPreview] = useState<Item | null>(null);
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const markDirty = (cellId: string, on: boolean) =>
    setDirty((d) => {
      const n = new Set(d);
      on ? n.add(cellId) : n.delete(cellId);
      return n;
    });

  const edit = (id: string, key: EditableField, value: string) =>
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, [key]: value } : r)));

  const commit = async (id: string, key: EditableField) => {
    const row = rows.find((r) => r.id === id);
    const orig = originals.current.get(id);
    if (!row || !orig) return;
    const cellId = `${id}:${key}`;
    if (row[key] === orig[key]) {
      markDirty(cellId, false);
      return;
    }
    markDirty(cellId, true);
    try {
      await api.updateItem(id, { [key]: row[key] } as Partial<Item>);
      originals.current.set(id, { ...orig, [key]: row[key] });
      toast(`保存: ${STATUS_LABEL[key] ?? key} を更新`, "success");
    } catch (e) {
      toast(`保存失敗: ${(e as Error).message}`, "error");
      edit(id, key, orig[key] as string); // 巻き戻し
    } finally {
      markDirty(cellId, false);
    }
  };

  const remove = async (it: Item) => {
    const ok = await confirm({
      title: "削除の確認",
      body: `「${[it.color, it.category].filter(Boolean).join(" ")}」を削除します。元に戻せません。よろしいですか？`,
      danger: true,
      okLabel: "削除する",
    });
    if (!ok) return;
    try {
      await api.deleteItem(it.id);
      toast("削除しました", "success");
      onChanged();
    } catch (e) {
      toast(`削除失敗: ${(e as Error).message}`, "error");
    }
  };

  const cellClass = (id: string, key: string) => (dirty.has(`${id}:${key}`) ? "rb-cell-dirty" : "");

  return (
    <div className="rb-table-wrap">
      <table className="rb-table">
        <thead>
          <tr>
            <th style={{ width: 92 }}>画像</th>
            <th style={{ width: 172 }}>管理番号</th>
            <th style={{ width: 96 }}>状態</th>
            {TEXT_COLS.map((c) => (
              <th key={c.key} style={{ width: c.w }}>{c.label}</th>
            ))}
            <th style={{ width: 120 }}>操作</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((it) => (
            <tr key={it.id}>
              <td>
                {/* 現物の識別が一番速いので画像を先頭に置く。クリックで詳細ポップアップ。 */}
                <div className="rb-cell-thumbs">
                  {it.image_keys.length > 0 ? (
                    it.image_keys.slice(0, 2).map((k) => (
                      <img
                        key={k}
                        src={imageUrl(k)}
                        alt=""
                        className="rb-cell-thumb"
                        onClick={() => setPreview(it)}
                      />
                    ))
                  ) : (
                    <span className="rb-cell-thumb rb-cell-thumb--empty">無</span>
                  )}
                </div>
              </td>
              <td className={cellClass(it.id, "display_id")}>
                <input
                  className="rb-cell-input"
                  value={it.display_id ?? ""}
                  onChange={(e) => edit(it.id, "display_id", e.target.value)}
                  onBlur={() => commit(it.id, "display_id")}
                  aria-label="管理番号"
                />
              </td>
              <td className={cellClass(it.id, "status")}>
                <select
                  className="rb-cell-input"
                  value={it.status}
                  onChange={(e) => edit(it.id, "status", e.target.value)}
                  onBlur={() => commit(it.id, "status")}
                  aria-label="状態"
                >
                  {meta.itemStatuses.map((s) => (
                    <option key={s} value={s}>{STATUS_LABEL[s]}</option>
                  ))}
                </select>
              </td>
              {TEXT_COLS.map((c) => (
                <td key={c.key} className={cellClass(it.id, c.key)}>
                  <input
                    className="rb-cell-input"
                    value={(it[c.key] as string) ?? ""}
                    onChange={(e) => edit(it.id, c.key, e.target.value)}
                    onBlur={() => commit(it.id, c.key)}
                    aria-label={c.label}
                  />
                </td>
              ))}
              <td>
                <div className="rb-row" style={{ gap: 4, padding: "0 6px", flexWrap: "nowrap" }}>
                  {/* 一覧の編集途中で画面を離れないよう、まずポップアップで確認 */}
                  <Button variant="outline" size="sm" onClick={() => setPreview(it)}>詳細</Button>
                  <Button variant="destructive" size="sm" onClick={() => remove(it)}>削除</Button>
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
      <ItemPreviewModal item={preview} context="管理 › 物品一覧" onClose={() => setPreview(null)} />
    </div>
  );
}
