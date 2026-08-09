"use client";
import { useEffect, useState } from "react";
import {
  Badge,
  Button,
  Field,
  Input,
  Modal,
  Select,
  Textarea,
  useToast,
  useConfirm,
  MetaOptionList,
} from "./ui";
import { MapPicker, findRegionAt, type Pin } from "./MapPicker";
import { ImageEditor } from "./ImageEditor";
import { useMeta } from "./useMeta";
import { useLocationPresets } from "./useLocationPresets";
import { api, isAppliedApiError } from "../lib/api";
import { formatIsoForDateTimeLocal, parseDateTimeLocalToIso } from "../lib/datetime";
import { STATUS_LABEL, type Item } from "../lib/types";

/**
 * 物品の編集をポップアップで行う。
 * 一覧や登録直後の流れを切らずに直せるようにするため、
 * 専用ページ（/items/[id]）と同等の項目をここでも編集できる。
 */
export function ItemEditModal({
  item,
  context,
  onClose,
  onSaved,
  onDeleted,
}: {
  item: Item | null;
  context: string;
  onClose: () => void;
  onSaved?: (updated: Item) => void;
  /** 削除完了時に呼ばれる（一覧側で行を消す・再読込するなどに使う）。 */
  onDeleted?: (id: string) => void;
}) {
  const meta = useMeta();
  const presets = useLocationPresets();
  const toast = useToast();
  const confirm = useConfirm();
  const [form, setForm] = useState<Partial<Item> & { tagsText?: string }>({});
  const [pin, setPin] = useState<Pin | null>(null);
  const [imageKeys, setImageKeys] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!item) return;
    setForm({ ...item, tagsText: item.tags.join("、") });
    setImageKeys(item.image_keys);
    setPin(
      item.found_x != null && item.found_y != null ? { x: item.found_x, y: item.found_y } : null,
    );
  }, [item?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!item) return null;
  const set = (k: string, v: any) => setForm((f) => ({ ...f, [k]: v }));
  const dt = formatIsoForDateTimeLocal(form.found_at);

  /** 追加した写真からAIで特徴を解析し、特徴文・タグを更新する。 */
  const analyze = async () => {
    if (imageKeys.length === 0) {
      toast("先に画像を追加してください", "error");
      return;
    }
    setAnalyzing(true);
    try {
      const d = await api.analyze({ keys: imageKeys, hint: form.notes || undefined });
      setForm((f) => ({
        ...f,
        ai_description: d.description || f.ai_description,
        tags: d.tags,
        tagsText: d.tags.length ? d.tags.join("、") : f.tagsText,
        category: f.category,
        color: f.color || d.color,
        brand: f.brand || d.brand,
      }));
      toast("AI解析が完了しました。内容を確認・修正してください", "success");
    } catch (e) {
      toast(`AI解析失敗: ${(e as Error).message}`, "error");
    } finally {
      setAnalyzing(false);
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      const { item: updated } = await api.updateItem(item.id, {
        display_id: form.display_id,
        status: form.status,
        category: form.category,
        color: form.color,
        brand: form.brand,
        storage_location: form.storage_location,
        found_location: form.found_location,
        found_at: form.found_at || null,
        found_x: pin?.x ?? null,
        found_y: pin?.y ?? null,
        image_keys: imageKeys,
        ai_description: form.ai_description,
        tags: (form.tagsText ?? "")
          .split(/[、,]/)
          .map((t) => t.trim())
          .filter(Boolean),
        notes: form.notes,
      });
      toast("保存しました", "success");
      onSaved?.(updated);
      onClose();
    } catch (e) {
      if (isAppliedApiError(e)) {
        try {
          const { item: updated } = await api.getItem(item.id);
          toast("保存内容は反映済みです。検索データの同期は保留中です", "success");
          onSaved?.(updated);
          onClose();
        } catch {
          toast("保存内容は反映済みです。最新状態を再読み込みしてください", "success");
          onClose();
        }
        return;
      }
      toast(`保存に失敗しました: ${(e as Error).message}`, "error");
    } finally {
      setSaving(false);
    }
  };

  const del = async () => {
    const ok = await confirm({
      title: "削除の確認",
      body: `「${[item.color, item.category].filter(Boolean).join(" ") || item.display_id || "物品"}」を削除します。元に戻せません。`,
      danger: true,
      okLabel: "削除する",
    });
    if (!ok) return;
    setDeleting(true);
    try {
      await api.deleteItem(item.id);
      toast("削除しました", "success");
      onDeleted?.(item.id);
      onClose();
    } catch (e) {
      toast(`削除失敗: ${(e as Error).message}`, "error");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Modal
      open={!!item}
      title={`編集: ${item.display_id || [item.color, item.category].filter(Boolean).join(" ") || "物品"}`}
      context={context}
      size="wide"
      onClose={onClose}
      footer={
        <>
          <Button variant="destructive" onClick={del} disabled={saving || deleting}>
            {deleting ? "削除中…" : "削除"}
          </Button>
          <Button variant="outline" onClick={onClose} disabled={saving || deleting}>
            キャンセル
          </Button>
          <Button onClick={save} disabled={saving || deleting}>
            {saving ? "保存中…" : "保存"}
          </Button>
        </>
      }
    >
      {item.ai_status === "pending" && (
        <div className="rb-banner rb-banner--warning mb-16">
          <span>⚠ AI解析中</span>
        </div>
      )}
      {item.ai_status === "error" && (
        <div className="rb-banner rb-banner--warning mb-16">
          <span>⚠ AI解析失敗</span>
        </div>
      )}

      <div className="rb-grid rb-grid--2">
        <div>
          <div className="rb-label mb-8">画像（最大2枚）</div>
          <ImageEditor keys={imageKeys} onChange={setImageKeys} disabled={saving} />
          <Button
            variant="outline"
            size="sm"
            block
            className="mt-8 mb-16"
            onClick={analyze}
            disabled={analyzing || saving || imageKeys.length === 0}
          >
            {analyzing ? "AI解析中…" : "AIで特徴を解析"}
          </Button>

          <div className="rb-between mb-8">
            <div className="rb-label" style={{ margin: 0 }}>
              拾得場所（エリアをタップ）
            </div>
            {form.found_location && <Badge tone="success">{form.found_location}</Badge>}
          </div>
          <MapPicker
            value={pin}
            regions={presets}
            activeRegionName={form.found_location || undefined}
            onChange={(p) => {
              setPin(p);
              set("found_location", p ? (findRegionAt(presets, p)?.name ?? "") : "");
            }}
          />
        </div>

        <div>
          <div className="rb-grid rb-grid--2">
            <Field label="管理番号">
              {(id) => (
                <Input
                  id={id}
                  value={form.display_id ?? ""}
                  onChange={(e) => set("display_id", e.target.value)}
                />
              )}
            </Field>
            <Field label="状態">
              {(id) => (
                <Select id={id} value={form.status} onChange={(e) => set("status", e.target.value)}>
                  {meta.itemStatuses.map((s) => (
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
                  onChange={(e) => set("category", e.target.value)}
                >
                  <option value="">未設定</option>
                  <MetaOptionList options={meta.categories} />
                </Select>
              )}
            </Field>
            <Field label="色">
              {(id) => (
                <Select id={id} value={form.color} onChange={(e) => set("color", e.target.value)}>
                  <option value="">未設定</option>
                  <MetaOptionList options={meta.colors} />
                </Select>
              )}
            </Field>
            <Field label="ブランド/型番">
              {(id) => (
                <Input
                  id={id}
                  value={form.brand ?? ""}
                  onChange={(e) => set("brand", e.target.value)}
                />
              )}
            </Field>
            <Field label="保管場所" required>
              {(id) => (
                <Input
                  id={id}
                  value={form.storage_location ?? ""}
                  onChange={(e) => set("storage_location", e.target.value)}
                />
              )}
            </Field>
            <Field label="拾得日時">
              {(id) => (
                <Input
                  id={id}
                  type="datetime-local"
                  value={dt}
                  onChange={(e) => {
                    try {
                      set("found_at", parseDateTimeLocalToIso(e.target.value));
                    } catch (error) {
                      toast((error as Error).message, "error");
                    }
                  }}
                />
              )}
            </Field>
          </div>
          <Field label="AI特徴文">
            {(id) => (
              <Textarea
                id={id}
                value={form.ai_description ?? ""}
                onChange={(e) => set("ai_description", e.target.value)}
              />
            )}
          </Field>
          <Field label="タグ" hint="読点/カンマ区切り。保存時に再ベクトル化されます">
            {(id) => (
              <Input
                id={id}
                value={form.tagsText ?? ""}
                onChange={(e) => set("tagsText", e.target.value)}
              />
            )}
          </Field>
          <Field label="メモ" hint="個人情報は入力しないでください">
            {(id) => (
              <Textarea
                id={id}
                value={form.notes ?? ""}
                onChange={(e) => set("notes", e.target.value)}
              />
            )}
          </Field>
        </div>
      </div>
    </Modal>
  );
}
