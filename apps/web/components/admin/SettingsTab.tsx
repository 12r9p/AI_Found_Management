"use client";
import { useEffect, useRef, useState } from "react";
import { Badge, Button, Card, Field, Input, Select, useToast, useConfirm } from "../ui";
import { MapPicker } from "../MapPicker";
import { api } from "../../lib/api";
import type { IdRule } from "../../lib/types";

/** 設定タブ: 会場地図と、種別・色の選択肢を編集する。 */
export function SettingsTab() {
  return (
    <div className="rb-col" id="settings">
      <IdRuleSetting />
      <MapSetting />
      <ListSetting
        kind="categories"
        title="種別（カテゴリ）"
        description="登録・検索・絞り込みで使う種別の選択肢です。現場で扱う物品に合わせて追加・削除できます。"
        placeholder="例: 折りたたみ傘"
      />
      <ListSetting
        kind="colors"
        title="色"
        description="登録・検索で使う色の選択肢です。"
        placeholder="例: モスグリーン"
      />
    </div>
  );
}

/** 管理番号（display_id）の採番ルール。紙台帳と突き合わせるため現場ごとに形式が違う。 */
function IdRuleSetting() {
  const toast = useToast();
  const [rule, setRule] = useState<IdRule | null>(null);
  const [preview, setPreview] = useState("");
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    api.getIdRule().then(({ rule, preview }) => {
      setRule(rule);
      setPreview(preview);
      setDirty(false);
    }).catch(() => {});
  }, []);

  if (!rule) return null;
  const set = <K extends keyof IdRule>(k: K, v: IdRule[K]) => {
    setRule((r) => (r ? { ...r, [k]: v } : r));
    setDirty(true);
  };

  // 保存前でも形式が分かるよう、その場でプレビューを組み立てる
  const localPreview = (() => {
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, "0");
    const y = d.getFullYear();
    const dp =
      rule.dateFormat === "YYYYMMDD" ? `${y}${p(d.getMonth() + 1)}${p(d.getDate())}`
      : rule.dateFormat === "YYMMDD" ? `${String(y).slice(2)}${p(d.getMonth() + 1)}${p(d.getDate())}`
      : rule.dateFormat === "YYYYMM" ? `${y}${p(d.getMonth() + 1)}`
      : "";
    return `${rule.prefix}${dp}${dp ? rule.separator : ""}${String(rule.start).padStart(rule.digits, "0")}`;
  })();

  const save = async () => {
    setSaving(true);
    try {
      const res = await api.updateIdRule(rule);
      setRule(res.rule);
      setPreview(res.preview);
      setDirty(false);
      toast("採番ルールを保存しました", "success");
    } catch (e) {
      toast(`保存に失敗しました: ${(e as Error).message}`, "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card variant="bordered">
      <h3 className="mb-8">管理番号の採番ルール</h3>
      <p className="rb-small muted-text">
        登録時に自動で付く管理番号の形式です。紙台帳の記法に合わせて設定してください。
        既に登録済みの番号は変更されません。
      </p>

      <Card variant="muted" className="mt-16 mb-16">
        <div className="rb-eyebrow mb-8">次に発行される番号（プレビュー）</div>
        <span className="rb-idtag" style={{ fontSize: 16 }}>{dirty ? localPreview : preview}</span>
      </Card>

      <div className="rb-grid rb-grid--3">
        <Field label="接頭辞" hint="例: FD-">
          {(id) => <Input id={id} value={rule.prefix} onChange={(e) => set("prefix", e.target.value)} />}
        </Field>
        <Field label="日付">
          {(id) => (
            <Select id={id} value={rule.dateFormat} onChange={(e) => set("dateFormat", e.target.value as IdRule["dateFormat"])}>
              <option value="none">なし</option>
              <option value="YYYYMMDD">年月日 (20260729)</option>
              <option value="YYMMDD">年月日 (260729)</option>
              <option value="YYYYMM">年月 (202607)</option>
            </Select>
          )}
        </Field>
        <Field label="区切り文字" hint="日付と連番の間">
          {(id) => <Input id={id} value={rule.separator} onChange={(e) => set("separator", e.target.value)} />}
        </Field>
        <Field label="連番の桁数">
          {(id) => (
            <Input id={id} type="number" min={1} max={10} value={rule.digits}
              onChange={(e) => set("digits", Number(e.target.value) || 1)} />
          )}
        </Field>
        <Field label="連番の開始値">
          {(id) => (
            <Input id={id} type="number" min={0} value={rule.start}
              onChange={(e) => set("start", Number(e.target.value) || 0)} />
          )}
        </Field>
        <Field label="連番のリセット" hint="この周期で開始値に戻ります">
          {(id) => (
            <Select id={id} value={rule.reset} onChange={(e) => set("reset", e.target.value as IdRule["reset"])}>
              <option value="never">しない（通し番号）</option>
              <option value="daily">毎日</option>
              <option value="monthly">毎月</option>
              <option value="yearly">毎年</option>
            </Select>
          )}
        </Field>
      </div>

      <div className="rb-row">
        <Button onClick={save} disabled={!dirty || saving}>{saving ? "保存中…" : "保存"}</Button>
        {dirty && <span className="rb-tiny" style={{ color: "var(--warning)" }}>未保存の変更があります</span>}
      </div>
    </Card>
  );
}

function MapSetting() {
  const toast = useToast();
  const [mapKey, setMapKey] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = () => api.getMap().then(setMapKey).catch(() => setMapKey(""));
  useEffect(() => { load(); }, []);

  const upload = async (f: File | undefined) => {
    if (!f) return;
    setUploading(true);
    try {
      const key = await api.uploadMap(f);
      setMapKey(key);
      toast("地図を更新しました。登録画面でピンを刺せます", "success");
    } catch (e) {
      toast(`アップロード失敗: ${(e as Error).message}`, "error");
    } finally {
      setUploading(false);
    }
  };

  return (
    <Card variant="bordered">
      <h3 className="mb-8">会場地図</h3>
      <p className="rb-small muted-text">
        アップロードした地図は登録画面・詳細画面で表示され、拾得場所をピンで指定できます。
        差し替えると以降の登録に使われます（既存のピン座標は相対位置で保持されます）。
      </p>

      {uploading && (
        <div className="rb-busy mt-16" role="status" aria-live="polite">
          <span className="rb-spinner" aria-hidden />
          <span>地図をアップロード中…</span>
        </div>
      )}

      <div className="rb-row mt-16">
        <Button onClick={() => fileRef.current?.click()} disabled={uploading}>
          {mapKey ? "地図を差し替える" : "地図をアップロード"}
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ""; }}
        />
        {mapKey ? <Badge tone="success">設定済</Badge> : <Badge tone="warning">未設定</Badge>}
      </div>

      {mapKey && (
        <div className="mt-16">
          <div className="rb-label mb-8">現在の地図</div>
          <MapPicker value={null} readOnly mapKeyOverride={mapKey} height={360} />
        </div>
      )}
    </Card>
  );
}

/** 種別・色の選択肢を編集する共通コンポーネント。 */
function ListSetting({
  kind,
  title,
  description,
  placeholder,
}: {
  kind: "categories" | "colors";
  title: string;
  description: string;
  placeholder: string;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const [values, setValues] = useState<string[]>([]);
  const [input, setInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const load = () =>
    api.meta().then((m) => {
      setValues(kind === "categories" ? m.categories : m.colors);
      setDirty(false);
    });
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const add = () => {
    const v = input.trim();
    if (!v) return;
    if (values.includes(v)) {
      toast("すでに登録されています", "error");
      return;
    }
    setValues((vs) => [...vs, v]);
    setInput("");
    setDirty(true);
  };

  const remove = async (v: string) => {
    // 既存データがその値を使っている可能性があるため、消す前に確認する
    const ok = await confirm({
      title: `${title}から削除`,
      body: `「${v}」を選択肢から削除します。\n既に登録済みの物品のデータは変更されませんが、選択肢には出なくなります。`,
      danger: true,
      okLabel: "削除する",
    });
    if (!ok) return;
    setValues((vs) => vs.filter((x) => x !== v));
    setDirty(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      await api.updateMeta(kind, values);
      toast(`${title}を保存しました`, "success");
      setDirty(false);
    } catch (e) {
      toast(`保存に失敗しました: ${(e as Error).message}`, "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card variant="bordered">
      <h3 className="mb-8">{title}</h3>
      <p className="rb-small muted-text">{description}</p>

      <div className="rb-chips mt-16 mb-16">
        {values.map((v) => (
          <span key={v} className="rb-chip">
            {v}
            <button type="button" onClick={() => remove(v)} aria-label={`${v} を削除`}>
              ×
            </button>
          </span>
        ))}
        {values.length === 0 && <span className="rb-tiny muted-text">項目がありません</span>}
      </div>

      <Field label="追加">
        {(id) => (
          <div className="rb-row" style={{ flexWrap: "nowrap" }}>
            <Input
              id={id}
              value={input}
              placeholder={placeholder}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                // IME 変換中の Enter は「確定」なので追加しない（半端な文字列の混入を防ぐ）
                if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  add();
                }
              }}
            />
            <Button variant="outline" onClick={add}>追加</Button>
          </div>
        )}
      </Field>

      <div className="rb-row">
        <Button onClick={save} disabled={!dirty || saving}>
          {saving ? "保存中…" : "保存"}
        </Button>
        {dirty && <span className="rb-tiny" style={{ color: "var(--warning)" }}>未保存の変更があります</span>}
      </div>
    </Card>
  );
}
