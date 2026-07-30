"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import { AppShell } from "../../components/AppShell";
import { Button, Card, Field, Input, Select, Textarea, Badge, useToast } from "../../components/ui";
import { useMeta } from "../../components/useMeta";
import { usePersistentState } from "../../components/usePersistentState";
import { MapPicker, type Pin } from "../../components/MapPicker";
import { ItemEditModal } from "../../components/ItemEditModal";
import { RegisteredModal } from "../../components/RegisteredModal";
import { api, imageUrl } from "../../lib/api";
import { normalizeImageFiles } from "../../lib/image";
import type { Item, Match } from "../../lib/types";

/** 拾得日時のクイック入力。現場は「今 / さっき」が大半。 */
const QUICK_TIMES = [
  { label: "今", min: 0 },
  { label: "10分前", min: 10 },
  { label: "30分前", min: 30 },
  { label: "1時間前", min: 60 },
];

/** n分前を datetime-local 用のローカル時刻文字列で返す。 */
function minutesAgoLocal(min: number): string {
  const d = new Date(Date.now() - min * 60_000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

const EMPTY = {
  category: "",
  color: "",
  brand: "",
  found_location: "",
  found_at: "",
  storage_location: "",
  ai_description: "",
  tags: "",
  notes: "",
};

export default function RegisterPage() {
  const meta = useMeta();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  // 画面を離れても入力を保持（現場では登録途中に別画面を見に行くことが多い）
  const [keys, setKeys, clearKeys] = usePersistentState<string[]>("register:keys", []);
  const [form, setForm, clearForm] = usePersistentState("register:form", { ...EMPTY });
  const [pin, setPin, clearPin] = usePersistentState<Pin | null>("register:pin", null);

  const [uploading, setUploading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ item: Item; matches: Match[] } | null>(null);
  const [editing, setEditing] = useState<Item | null>(null);

  /** 確認ポップアップを閉じたら、編集導線をトーストで残す（押し直せる猶予を作る）。 */
  const closeResult = () => {
    const saved = result?.item;
    setResult(null);
    if (!saved) return;
    toast(`${saved.display_id || "物品"} を登録しました`, {
      tone: "success",
      action: { label: "登録内容を編集", onClick: () => setEditing(saved) },
    });
  };

  const set = (k: keyof typeof EMPTY, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const onPick = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const picked = Array.from(files).slice(0, 2 - keys.length);
    setUploading(true);
    try {
      const normalized = await normalizeImageFiles(picked);
      const { keys: newKeys } = await api.upload(normalized);
      setKeys([...keys, ...newKeys].slice(0, 2));
      // AI解析は自動実行しない（複数枚まとめて追加してから「AIで特徴を解析」で手動起動する運用のため）
    } catch (e) {
      toast(`アップロード失敗: ${(e as Error).message}`, "error");
    } finally {
      setUploading(false);
    }
  };

  const analyze = async (useKeys = keys) => {
    if (useKeys.length === 0) {
      toast("先に画像を追加してください", "error");
      return;
    }
    setAnalyzing(true);
    try {
      const d = await api.analyze({ keys: useKeys, hint: form.notes || undefined });
      setForm((f) => ({
        ...f,
        ai_description: d.description || f.ai_description,
        tags: d.tags.length ? d.tags.join("、") : f.tags,
        category: f.category || d.category,
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

  const removeImage = (key: string) => setKeys((ks) => ks.filter((k) => k !== key));

  const resetAll = () => {
    clearForm();
    clearKeys();
    clearPin();
  };

  const submit = async () => {
    if (!form.category) {
      toast("種別（カテゴリ）は必須です", "error");
      return;
    }
    setSaving(true);
    try {
      const res = await api.createItem({
        category: form.category,
        color: form.color,
        brand: form.brand,
        found_location: form.found_location,
        found_at: form.found_at ? new Date(form.found_at).toISOString() : null,
        found_x: pin?.x ?? null,
        found_y: pin?.y ?? null,
        storage_location: form.storage_location,
        image_keys: keys,
        ai_description: form.ai_description,
        tags: form.tags.split(/[、,]/).map((t) => t.trim()).filter(Boolean),
        notes: form.notes,
      });
      setResult(res);
      if (res.matches.length > 0) {
        toast(`未解決の問い合わせと${res.matches.length}件一致！ 通知を確認してください`, "success");
      } else {
        toast("登録しました", "success");
      }
      resetAll();
    } catch (e) {
      toast(`登録失敗: ${(e as Error).message}`, "error");
    } finally {
      setSaving(false);
    }
  };

  const busy = uploading || analyzing;
  const hasDraft = keys.length > 0 || Object.values(form).some(Boolean) || pin;

  return (
    <AppShell>
      <div className="rb-between mb-16">
        <div>
          <div className="rb-eyebrow muted-text">現場登録 / MOBILE</div>
          <h2>拾得物の登録</h2>
        </div>
        {hasDraft && (
          <Button variant="outline" size="sm" onClick={resetAll}>
            入力をクリア
          </Button>
        )}
      </div>

      <Card variant="bordered" className="mb-16">
        <div className="rb-label mb-8">画像（最大2枚）</div>

        {busy && (
          <div className="rb-busy mb-16" role="status" aria-live="polite">
            <span className="rb-spinner" aria-hidden />
            <span>{uploading ? "画像をアップロード中…" : "AIが画像を解析中… 特徴文とタグを生成しています"}</span>
          </div>
        )}

        <div className="rb-grid rb-grid--2 mb-16">
          {keys.map((k) => (
            <div key={k}>
              <div className="rb-rel">
                <img src={imageUrl(k)} alt="拾得物" className="thumb" />
                {analyzing && (
                  <div className="rb-overlay-busy">
                    <span className="rb-spinner" aria-hidden />
                    AI解析中…
                  </div>
                )}
              </div>
              <Button variant="destructive" size="sm" block className="mt-8" onClick={() => removeImage(k)} disabled={busy}>
                削除
              </Button>
            </div>
          ))}
          {keys.length < 2 && (
            <div
              className="dropzone"
              onClick={() => !busy && fileRef.current?.click()}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && !busy && fileRef.current?.click()}
            >
              ＋ 写真を撮る / 選ぶ
              <div className="rb-tiny muted-text mt-8">タップしてカメラ起動</div>
            </div>
          )}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          capture="environment"
          multiple
          hidden
          onChange={(e) => {
            onPick(e.target.files);
            e.target.value = ""; // 同じ画像の再選択を許可
          }}
        />
        <Button variant="outline" block onClick={() => analyze()} disabled={busy || keys.length === 0}>
          {analyzing ? "AI解析中…" : "AIで特徴を解析"}
        </Button>
      </Card>

      <Card variant="bordered" className="mb-16">
        <div className="rb-label mb-8">拾得場所（地図をタップ）</div>
        <MapPicker value={pin} onChange={setPin} />
      </Card>

      <Card variant="bordered">
        <div className="rb-grid rb-grid--2">
          <Field label="種別" required>
            {(id) => (
              <Select id={id} value={form.category} onChange={(e) => set("category", e.target.value)}>
                <option value="">選択…</option>
                {meta.categories.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="色">
            {(id) => (
              <Select id={id} value={form.color} onChange={(e) => set("color", e.target.value)}>
                <option value="">選択…</option>
                {meta.colors.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="ブランド/型番">
            {(id) => <Input id={id} value={form.brand} onChange={(e) => set("brand", e.target.value)} />}
          </Field>
          <Field label="保管場所" hint="棚番号など">
            {(id) => (
              <Input id={id} value={form.storage_location} onChange={(e) => set("storage_location", e.target.value)} />
            )}
          </Field>
          <Field label="拾得場所メモ" hint="地図の補足（例: 東ゲート付近）">
            {(id) => (
              <Input id={id} value={form.found_location} onChange={(e) => set("found_location", e.target.value)} />
            )}
          </Field>
          <Field label="拾得日時">
            {(id) => (
              <>
                {/* 現場では「さっき拾った」がほとんど。毎回カレンダーを触らせない。 */}
                <div className="rb-quick">
                  {QUICK_TIMES.map((qt) => (
                    <Button
                      key={qt.label}
                      variant="outline"
                      size="sm"
                      onClick={() => set("found_at", minutesAgoLocal(qt.min))}
                    >
                      {qt.label}
                    </Button>
                  ))}
                  {form.found_at && (
                    <Button variant="ghost" size="sm" onClick={() => set("found_at", "")}>
                      クリア
                    </Button>
                  )}
                </div>
                <Input id={id} type="datetime-local" value={form.found_at} onChange={(e) => set("found_at", e.target.value)} />
              </>
            )}
          </Field>
        </div>
        <Field label="AI特徴文" hint="AIが生成。誤りは修正可">
          {(id) => (
            <Textarea id={id} value={form.ai_description} onChange={(e) => set("ai_description", e.target.value)} />
          )}
        </Field>
        <Field label="タグ" hint="読点/カンマ区切り">
          {(id) => <Input id={id} value={form.tags} onChange={(e) => set("tags", e.target.value)} />}
        </Field>
        <Field label="メモ（個人情報は不可）">
          {(id) => <Textarea id={id} value={form.notes} onChange={(e) => set("notes", e.target.value)} />}
        </Field>
        <Button block onClick={submit} disabled={saving || busy}>
          {saving ? "登録中…" : "この内容で登録する"}
        </Button>
      </Card>

      {/* 登録直後の確認はポップアップ（続けて登録しやすいよう手を止めない） */}
      <RegisteredModal
        result={result}
        onClose={closeResult}
        onContinue={() => setResult(null)}
      />
      <ItemEditModal
        item={editing}
        context="登録 › 登録完了"
        onClose={() => setEditing(null)}
      />
    </AppShell>
  );
}
