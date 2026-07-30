"use client";
import { useRef, useState } from "react";
import { AppShell } from "../../components/AppShell";
import { Button, Card, Field, Input, Textarea, useToast } from "../../components/ui";
import { usePersistentState } from "../../components/usePersistentState";
import { MapPicker, type Pin } from "../../components/MapPicker";
import { ItemEditModal } from "../../components/ItemEditModal";
import { RegisteredModal } from "../../components/RegisteredModal";
import { api, imageUrl } from "../../lib/api";
import { normalizeImageFiles } from "../../lib/image";
import type { Item } from "../../lib/types";

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

// 種別・色・特徴文・タグはAIが解析して自動で埋めるため、人間の入力対象から外す。
// ここで入力するのはAIには分からない項目だけ。
const EMPTY = {
  brand: "",
  found_location: "",
  found_at: "",
  storage_location: "",
  notes: "",
};

export default function RegisterPage() {
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  // 画面を離れても入力を保持（現場では登録途中に別画面を見に行くことが多い）
  const [keys, setKeys] = usePersistentState<string[]>("register:keys", []);
  const [form, setForm] = usePersistentState("register:form", { ...EMPTY });
  const [pin, setPin] = usePersistentState<Pin | null>("register:pin", null);

  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<Item | null>(null);
  const [editing, setEditing] = useState<Item | null>(null);

  const set = (k: keyof typeof EMPTY, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const onPick = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const picked = Array.from(files).slice(0, 2 - keys.length);
    setUploading(true);
    try {
      const normalized = await normalizeImageFiles(picked);
      const { keys: newKeys } = await api.upload(normalized);
      setKeys([...keys, ...newKeys].slice(0, 2));
      // AI解析はサーバー側が登録時にバックグラウンドで自動実行するため、ここでは呼ばない
    } catch (e) {
      toast(`アップロード失敗: ${(e as Error).message}`, "error");
    } finally {
      setUploading(false);
    }
  };

  const removeImage = (key: string) => setKeys((ks) => ks.filter((k) => k !== key));

  /** 次の登録へ。同じ場所からまとめて届くことが多いため、保管場所・拾得場所・
   * 拾得日時・地図ピンだけは引き継ぎ、画像やブランド・メモは空に戻す。 */
  const resetForNextBatch = () => {
    setForm((f) => ({
      ...EMPTY,
      found_location: f.found_location,
      storage_location: f.storage_location,
      found_at: f.found_at,
    }));
    setKeys([]);
    // pin はそのまま引き継ぐ（意図的に clearPin しない）
  };

  const hasDraft = keys.length > 0 || Object.values(form).some(Boolean) || pin;

  const resetAll = () => {
    setForm({ ...EMPTY });
    setKeys([]);
    setPin(null);
  };

  /** 確認ポップアップを閉じたら、編集導線をトーストで残す（押し直せる猶予を作る）。 */
  const closeResult = () => {
    const saved = result;
    setResult(null);
    if (!saved) return;
    toast(`${saved.display_id || "物品"} を登録しました`, {
      tone: "success",
      action: { label: "登録内容を編集", onClick: () => setEditing(saved) },
    });
    resetForNextBatch();
  };

  const editFromResult = (item: Item) => {
    setResult(null);
    toast(`${item.display_id || "物品"} を登録しました`, {
      tone: "success",
      action: { label: "登録内容を編集", onClick: () => setEditing(item) },
    });
    resetForNextBatch();
    setEditing(item);
  };

  const submit = async () => {
    if (uploading) return; // 送信中の写真がある場合はアップロード完了を待つ
    setSaving(true);
    try {
      const item = await api.createItem({
        brand: form.brand,
        found_location: form.found_location,
        found_at: form.found_at ? new Date(form.found_at).toISOString() : null,
        found_x: pin?.x ?? null,
        found_y: pin?.y ?? null,
        storage_location: form.storage_location,
        image_keys: keys,
        notes: form.notes,
      });
      setResult(item.item);
    } catch (e) {
      toast(`登録失敗: ${(e as Error).message}`, "error");
    } finally {
      setSaving(false);
    }
  };

  const busy = uploading;

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
        <p className="rb-tiny muted-text mb-8">
          種別・色・特徴文・タグはAIが自動解析します（登録後にバックグラウンドで進行、待たずに次へ進めます）。
        </p>

        {uploading && (
          <div className="rb-busy mb-16" role="status" aria-live="polite">
            <span className="rb-spinner" aria-hidden />
            <span>画像を送信中…</span>
          </div>
        )}

        <div className="rb-grid rb-grid--2 mb-16">
          {keys.map((k) => (
            <div key={k}>
              <img src={imageUrl(k)} alt="拾得物" className="thumb" />
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
      </Card>

      <Card variant="bordered" className="mb-16">
        <div className="rb-label mb-8">拾得場所（地図をタップ）</div>
        <MapPicker value={pin} onChange={setPin} />
      </Card>

      <Card variant="bordered">
        <div className="rb-eyebrow mb-8">AIには分からない情報</div>
        <div className="rb-grid rb-grid--2">
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
        <Field label="メモ（個人情報は不可）">
          {(id) => <Textarea id={id} value={form.notes} onChange={(e) => set("notes", e.target.value)} />}
        </Field>
        <Button block onClick={submit} disabled={saving || busy}>
          {saving ? "登録中…" : uploading ? "画像の送信を待っています…" : "この内容で登録する"}
        </Button>
      </Card>

      {/* 登録直後の確認はポップアップ（続けて登録しやすいよう手を止めない） */}
      <RegisteredModal
        item={result}
        onClose={closeResult}
        onEdit={editFromResult}
      />
      <ItemEditModal
        item={editing}
        context="登録 › 登録完了"
        onClose={() => setEditing(null)}
      />
    </AppShell>
  );
}
