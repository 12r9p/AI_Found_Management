"use client";
import { useRef, useState } from "react";
import { AppShell } from "../../components/AppShell";
import { Badge, Button, Card, Field, Input, Textarea, useToast } from "../../components/ui";
import { usePersistentState } from "../../components/usePersistentState";
import { MapPicker, findRegionAt, type Pin } from "../../components/MapPicker";
import { useLocationPresets } from "../../components/useLocationPresets";
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

// 種別・色・特徴文・タグはAIが自動で埋める。人間の入力は拾得日時（必須）とメモのみ。
const EMPTY = {
  found_at: "",
  notes: "",
};

export default function RegisterPage() {
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const presets = useLocationPresets();

  // 画面を離れても入力を保持（現場では登録途中に別画面を見に行くことが多い）
  const [keys, setKeys] = usePersistentState<string[]>("register:keys", []);
  const [form, setForm] = usePersistentState("register:form", { ...EMPTY });
  const [pin, setPin] = usePersistentState<Pin | null>("register:pin", null);
  // タップした位置がプリセットの塗りつぶしエリア内なら自動でセットされる。
  // エリア外をタップした場合は対応するプリセットが無いので空に戻る。
  const [foundLocation, setFoundLocation] = usePersistentState("register:foundLocation", "");

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
    } catch (e) {
      toast(`アップロード失敗: ${(e as Error).message}`, "error");
    } finally {
      setUploading(false);
    }
  };

  const removeImage = (key: string) => setKeys((ks) => ks.filter((k) => k !== key));

  /** 次の登録へ。同じ場所・同じ頃にまとめて届くことが多いため、拾得日時・
   * 拾得場所・地図ピンだけ引き継ぎ、画像・メモは空に戻す。 */
  const resetForNextBatch = () => {
    setForm((f) => ({ ...EMPTY, found_at: f.found_at }));
    setKeys([]);
  };

  const hasDraft = keys.length > 0 || !!form.notes || !!form.found_at || !!foundLocation || pin;

  const resetAll = () => {
    setForm({ ...EMPTY });
    setKeys([]);
    setPin(null);
    setFoundLocation("");
  };

  /** 登録直後のトースト。押し直せる猶予として編集導線を残す。 */
  const notifyRegistered = (saved: Item) => {
    toast(`${saved.display_id || "物品"} を登録しました`, {
      tone: "success",
      action: { label: "登録内容を編集", onClick: () => setEditing(saved) },
    });
  };

  /** 「閉じる」= 完全リセットしてまっさらな登録画面へ。次の入力へすぐ移れるよう先頭へ戻す。 */
  const handleClose = () => {
    const saved = result;
    setResult(null);
    if (!saved) return;
    notifyRegistered(saved);
    resetAll();
    window.scrollTo({ top: 0 });
  };

  /** 「続けて登録」(主動線) = 拾得場所などを引き継いだまま次の登録へ。先頭へ戻す。 */
  const handleContinue = () => {
    const saved = result;
    setResult(null);
    if (!saved) return;
    notifyRegistered(saved);
    resetForNextBatch();
    window.scrollTo({ top: 0 });
  };

  const handleEditFromResult = (item: Item) => {
    setResult(null);
    notifyRegistered(item);
    resetForNextBatch();
    setEditing(item);
  };

  const submit = async () => {
    if (uploading) return; // 送信中の写真がある場合はアップロード完了を待つ
    if (!form.found_at) {
      toast("拾得日時は必須です", "error");
      return;
    }
    setSaving(true);
    try {
      const item = await api.createItem({
        found_at: new Date(form.found_at).toISOString(),
        found_location: foundLocation,
        found_x: pin?.x ?? null,
        found_y: pin?.y ?? null,
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
        <div className="rb-between mb-8">
          <div className="rb-label" style={{ margin: 0 }}>拾得場所（エリアをタップ）</div>
          {foundLocation && <Badge tone="success">{foundLocation}</Badge>}
        </div>
        <MapPicker
          value={pin}
          regions={presets}
          activeRegionName={foundLocation || undefined}
          onChange={(p) => {
            setPin(p);
            setFoundLocation(p ? findRegionAt(presets, p)?.name ?? "" : "");
          }}
        />
      </Card>

      <Card variant="bordered">
        <Field label="拾得日時" required>
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
              </div>
              <Input id={id} type="datetime-local" value={form.found_at} onChange={(e) => set("found_at", e.target.value)} />
            </>
          )}
        </Field>
        <Field label="メモ" hint="ブランドなど、気づいたことがあれば">
          {(id) => <Textarea id={id} value={form.notes} onChange={(e) => set("notes", e.target.value)} />}
        </Field>
        <Button block onClick={submit} disabled={saving || busy}>
          {saving ? "登録中…" : uploading ? "画像の送信を待っています…" : "この内容で登録する"}
        </Button>
      </Card>

      {/* 登録直後の確認はポップアップ（続けて登録しやすいよう手を止めない） */}
      <RegisteredModal
        item={result}
        onClose={handleClose}
        onContinue={handleContinue}
        onEdit={handleEditFromResult}
      />
      <ItemEditModal
        item={editing}
        context="登録 › 登録完了"
        onClose={() => setEditing(null)}
      />
    </AppShell>
  );
}
