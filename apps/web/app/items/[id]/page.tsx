"use client";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AppShell } from "../../../components/AppShell";
import { Button, Card, Field, Input, Select, Textarea, Badge, useToast, useConfirm } from "../../../components/ui";
import { useMeta } from "../../../components/useMeta";
import { MapPicker, type Pin } from "../../../components/MapPicker";
import { ImageEditor } from "../../../components/ImageEditor";
import { api } from "../../../lib/api";
import { STATUS_LABEL, type Item, type Match } from "../../../lib/types";

export default function ItemDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const meta = useMeta();
  const toast = useToast();
  const confirm = useConfirm();
  const [item, setItem] = useState<Item | null>(null);
  const [matches, setMatches] = useState<Match[]>([]);
  const [form, setForm] = useState<Partial<Item> & { tagsText?: string }>({});
  const [imageKeys, setImageKeys] = useState<string[]>([]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);

  const load = () =>
    api.getItem(id).then(({ item, matches }) => {
      setItem(item);
      setMatches(matches);
      setForm({ ...item, tagsText: item.tags.join("、") });
      setImageKeys(item.image_keys);
      setDirty(false);
    }).catch((e) => toast(`読込失敗: ${e.message}`, "error"));

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [id]);

  const set = (k: string, v: any) => { setForm((f) => ({ ...f, [k]: v })); setDirty(true); };
  const setImages = (keys: string[]) => { setImageKeys(keys); setDirty(true); };

  /** 追加した写真からAIで特徴を解析し、特徴文・タグを更新する。 */
  const analyze = async () => {
    if (imageKeys.length === 0) {
      toast("先に画像を追加してください", "error");
      return;
    }
    setAnalyzing(true);
    try {
      const d = await api.analyze({ keys: imageKeys, hint: form.notes || undefined });
      set("ai_description", d.description || form.ai_description);
      if (d.tags.length) set("tagsText", d.tags.join("、"));
      if (!form.category && d.category) set("category", d.category);
      if (!form.color && d.color) set("color", d.color);
      if (!form.brand && d.brand) set("brand", d.brand);
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
      await api.updateItem(id, {
        status: form.status,
        category: form.category,
        color: form.color,
        brand: form.brand,
        found_location: form.found_location,
        found_at: form.found_at || null,
        storage_location: form.storage_location,
        found_x: form.found_x ?? null,
        found_y: form.found_y ?? null,
        image_keys: imageKeys,
        ai_description: form.ai_description,
        tags: (form.tagsText ?? "").split(/[、,]/).map((t) => t.trim()).filter(Boolean),
        notes: form.notes,
      });
      toast("保存しました", "success");
      load();
    } catch (e) {
      toast(`保存失敗: ${(e as Error).message}`, "error");
    } finally {
      setSaving(false);
    }
  };

  /** 直前の画面へ戻る。単独で開かれた場合（履歴なし）は物品一覧へ。 */
  const goBack = () => {
    if (window.history.length > 1) router.back();
    else router.push("/admin#items");
  };

  const del = async () => {
    const ok = await confirm({ title: "削除の確認", body: "この物品を削除します。元に戻せません。", danger: true, okLabel: "削除する" });
    if (!ok) return;
    await api.deleteItem(id);
    toast("削除しました", "success");
    router.push("/admin");
  };

  if (!item) {
    return <AppShell><p className="rb-mono">読込中…</p></AppShell>;
  }

  const dt = form.found_at ? new Date(form.found_at).toISOString().slice(0, 16) : "";

  return (
    <AppShell>
      <div className="rb-between mb-16">
        <div>
          <div className="rb-eyebrow muted-text">物品 / {item.id.slice(0, 8)}</div>
          <h2>{[item.color, item.category].filter(Boolean).join(" ") || "物品詳細"}</h2>
        </div>
        {/* 直前の画面（照合・探す・一覧）へ戻す。履歴が無ければ物品一覧へ。 */}
        <Button variant="outline" onClick={goBack}>
          ← 戻る
        </Button>
      </div>

      {dirty && (
        <div className="rb-banner rb-banner--warning mb-16">
          <span>⚠ 未保存の変更があります</span>
          <span>「保存」を押すまで反映されません。</span>
        </div>
      )}

      <div className="rb-grid rb-grid--2">
        <div className="rb-col">
          <Card variant="bordered">
            <div className="rb-label mb-8">画像（最大2枚）</div>
            <ImageEditor keys={imageKeys} onChange={setImages} disabled={saving} />
            <Button
              variant="outline"
              size="sm"
              block
              className="mt-8"
              onClick={analyze}
              disabled={analyzing || saving || imageKeys.length === 0}
            >
              {analyzing ? "AI解析中…" : "AIで特徴を解析"}
            </Button>
          </Card>

          <Card variant="bordered">
            <div className="rb-label mb-8">拾得場所（地図をタップで修正）</div>
            <MapPicker
              value={
                form.found_x != null && form.found_y != null
                  ? { x: form.found_x, y: form.found_y }
                  : null
              }
              onChange={(pin: Pin | null) => {
                set("found_x", pin ? pin.x : null);
                set("found_y", pin ? pin.y : null);
              }}
              height={260}
            />
            {item.found_location && (
              <div className="rb-tiny muted-text mt-8">メモ: {item.found_location}</div>
            )}
          </Card>

          <Card variant="muted">
            <div className="rb-eyebrow mb-8">メタ情報</div>
            <div className="rb-mono rb-small">
              登録: {new Date(item.created_at).toLocaleString("ja-JP")}<br />
              更新: {new Date(item.updated_at).toLocaleString("ja-JP")}<br />
              タグ: {item.tags.join(" / ") || "—"}
            </div>
          </Card>

          {matches.length > 0 && (
            <Card variant="elevated">
              <div className="rb-eyebrow mb-8" style={{ color: "var(--warning)" }}>突き合わせ候補</div>
              {matches.map((m) => (
                <div key={m.id} className="rb-small mb-8">
                  問い合わせ {m.inquiry_id.slice(0, 8)} — {(m.score * 100).toFixed(0)}% <Badge>{STATUS_LABEL[m.status]}</Badge>
                </div>
              ))}
            </Card>
          )}
        </div>

        <Card variant="bordered">
          <div className="rb-between mb-8">
            <div className="rb-label">編集（DB直接編集）</div>
            <Badge tone={item.status === "stored" ? "success" : "info"}>{STATUS_LABEL[item.status]}</Badge>
          </div>
          <div className="rb-grid rb-grid--2">
            <Field label="状態">
              {(id) => (
                <Select id={id} value={form.status} onChange={(e) => set("status", e.target.value)}>
                  {meta.itemStatuses.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                </Select>
              )}
            </Field>
            <Field label="種別">
              {(id) => (
                <Select id={id} value={form.category} onChange={(e) => set("category", e.target.value)}>
                  {meta.categories.map((c) => <option key={c}>{c}</option>)}
                </Select>
              )}
            </Field>
            <Field label="色">
              {(id) => (
                <Select id={id} value={form.color} onChange={(e) => set("color", e.target.value)}>
                  <option value="">—</option>
                  {meta.colors.map((c) => <option key={c}>{c}</option>)}
                </Select>
              )}
            </Field>
            <Field label="ブランド/型番">
              {(id) => <Input id={id} value={form.brand ?? ""} onChange={(e) => set("brand", e.target.value)} />}
            </Field>
            <Field label="拾得場所">
              {(id) => <Input id={id} value={form.found_location ?? ""} onChange={(e) => set("found_location", e.target.value)} />}
            </Field>
            <Field label="拾得日時">
              {(id) => <Input id={id} type="datetime-local" value={dt} onChange={(e) => set("found_at", e.target.value ? new Date(e.target.value).toISOString() : null)} />}
            </Field>
            <Field label="保管場所">
              {(id) => <Input id={id} value={form.storage_location ?? ""} onChange={(e) => set("storage_location", e.target.value)} />}
            </Field>
          </div>
          <Field label="AI特徴文">
            {(id) => <Textarea id={id} value={form.ai_description ?? ""} onChange={(e) => set("ai_description", e.target.value)} />}
          </Field>
          <Field label="タグ" hint="読点/カンマ区切り。保存時に再ベクトル化されます">
            {(id) => <Input id={id} value={form.tagsText ?? ""} onChange={(e) => set("tagsText", e.target.value)} />}
          </Field>
          <Field label="メモ（個人情報は不可）">
            {(id) => <Textarea id={id} value={form.notes ?? ""} onChange={(e) => set("notes", e.target.value)} />}
          </Field>
          <div className="rb-row">
            <Button onClick={save} disabled={saving}>{saving ? "保存中…" : "保存"}</Button>
            <Button variant="destructive" onClick={del}>削除</Button>
          </div>
        </Card>
      </div>
    </AppShell>
  );
}
