"use client";
import { useEffect, useRef, useState } from "react";
import { Badge, Button, Card, Field, Input, Modal, Select, useToast, useConfirm, ColorSwatch } from "../ui";
import { MapPicker, invalidateMapCache, type Pin } from "../MapPicker";
import { api } from "../../lib/api";
import type { IdRule, LocationPreset, MetaOption } from "../../lib/types";
import { normalizeImageFile } from "../../lib/image";

/** 設定タブ: 会場地図と、種別・色の選択肢を編集する。 */
export function SettingsTab() {
  return (
    <div className="rb-col" id="settings">
      <IdRuleSetting />
      <MapSetting />
      <LocationPresetSetting />
      <ListSetting
        kind="categories"
        title="種別（カテゴリ）"
        description="登録・検索・絞り込みで使う種別の選択肢です。"
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

/** 管理番号（display_id）の採番ルール。紙台帳と突き合わせるため現場ごとに形式が違う。
 * 編集はポップアップ内で行い、設定画面本体のレイアウトは変わらないようにする。 */
function IdRuleSetting() {
  const toast = useToast();
  const [rule, setRule] = useState<IdRule | null>(null);
  const [preview, setPreview] = useState("");
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<IdRule | null>(null);

  useEffect(() => {
    api.getIdRule().then(({ rule, preview }) => {
      setRule(rule);
      setPreview(preview);
    }).catch(() => {});
  }, []);

  if (!rule) return null;
  const set = <K extends keyof IdRule>(k: K, v: IdRule[K]) => {
    setDraft((r) => (r ? { ...r, [k]: v } : r));
  };

  // 保存前でも形式が分かるよう、その場でプレビューを組み立てる
  const localPreview = (d: IdRule) => {
    const now = new Date();
    const p = (n: number) => String(n).padStart(2, "0");
    const y = now.getFullYear();
    const dp =
      d.dateFormat === "YYYYMMDD" ? `${y}${p(now.getMonth() + 1)}${p(now.getDate())}`
      : d.dateFormat === "YYMMDD" ? `${String(y).slice(2)}${p(now.getMonth() + 1)}${p(now.getDate())}`
      : d.dateFormat === "YYYYMM" ? `${y}${p(now.getMonth() + 1)}`
      : "";
    return `${d.prefix}${dp}${dp ? d.separator : ""}${String(d.start).padStart(d.digits, "0")}`;
  };

  const openEdit = () => {
    setDraft(rule);
    setOpen(true);
  };
  const cancel = () => {
    setOpen(false);
    setDraft(null);
  };

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      const res = await api.updateIdRule(draft);
      setRule(res.rule);
      setPreview(res.preview);
      toast("採番ルールを保存しました", "success");
      setOpen(false);
      setDraft(null);
    } catch (e) {
      toast(`保存に失敗しました: ${(e as Error).message}`, "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Card variant="bordered">
        <div className="rb-between mb-8">
          <h3 style={{ margin: 0 }}>管理番号の採番ルール</h3>
          <Button variant="outline" size="sm" onClick={openEdit}>編集</Button>
        </div>
        <p className="rb-small muted-text">
          登録時に自動で付く管理番号の形式です。紙台帳の記法に合わせて設定してください。
        </p>
        <Card variant="muted" className="mt-16">
          <div className="rb-eyebrow mb-8">採番フォーマットの例（プレビュー）</div>
          <span className="rb-idtag" style={{ fontSize: 16 }}>{preview}</span>
        </Card>
      </Card>

      <Modal
        open={open}
        title="管理番号の採番ルールを編集"
        context="管理 › 設定"
        size="wide"
        onClose={cancel}
        footer={
          <>
            <Button variant="outline" onClick={cancel} disabled={saving}>キャンセル</Button>
            <Button onClick={save} disabled={saving}>{saving ? "保存中…" : "保存"}</Button>
          </>
        }
      >
        {draft && (
          <>
            <Card variant="muted" className="mb-16">
              <div className="rb-eyebrow mb-8">採番フォーマットの例（プレビュー）</div>
              <span className="rb-idtag" style={{ fontSize: 16 }}>{localPreview(draft)}</span>
            </Card>
            <div className="rb-grid rb-grid--3">
              <Field label="接頭辞" hint="例: FD-">
                {(id) => <Input id={id} value={draft.prefix} onChange={(e) => set("prefix", e.target.value)} />}
              </Field>
              <Field label="日付">
                {(id) => (
                  <Select id={id} value={draft.dateFormat} onChange={(e) => set("dateFormat", e.target.value as IdRule["dateFormat"])}>
                    <option value="none">なし</option>
                    <option value="YYYYMMDD">年月日 (20260729)</option>
                    <option value="YYMMDD">年月日 (260729)</option>
                    <option value="YYYYMM">年月 (202607)</option>
                  </Select>
                )}
              </Field>
              <Field label="区切り文字" hint="日付と連番の間">
                {(id) => <Input id={id} value={draft.separator} onChange={(e) => set("separator", e.target.value)} />}
              </Field>
              <Field label="連番の桁数">
                {(id) => (
                  <Input id={id} type="number" min={1} max={10} value={draft.digits}
                    onChange={(e) => set("digits", Number(e.target.value) || 1)} />
                )}
              </Field>
              <Field label="連番の開始値">
                {(id) => (
                  <Input id={id} type="number" min={0} value={draft.start}
                    onChange={(e) => set("start", Number(e.target.value) || 0)} />
                )}
              </Field>
              <Field label="連番のリセット" hint="この周期で開始値に戻ります">
                {(id) => (
                  <Select id={id} value={draft.reset} onChange={(e) => set("reset", e.target.value as IdRule["reset"])}>
                    <option value="never">しない（通し番号）</option>
                    <option value="daily">毎日</option>
                    <option value="monthly">毎月</option>
                    <option value="yearly">毎年</option>
                  </Select>
                )}
              </Field>
            </div>
          </>
        )}
      </Modal>
    </>
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
      const normalized = await normalizeImageFile(f);
      if (normalized.size > 10 * 1024 * 1024) {
        throw new Error("地図画像が大きすぎます。10MB以内の画像を選択してください。");
      }
      const key = await api.uploadMap(normalized);
      setMapKey(key);
      invalidateMapCache();
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
          <MapPicker value={null} readOnly mapKeyOverride={mapKey} />
        </div>
      )}
    </Card>
  );
}

/** 拾得場所プリセット: 地図上をエリアで塗りつぶして名前を付ける。
 * 登録・編集画面ではそのエリア内をタップするだけで拾得場所名とピンが同時に決まる。 */
function LocationPresetSetting() {
  const toast = useToast();
  const confirm = useConfirm();
  const [presets, setPresets] = useState<LocationPreset[]>([]);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<LocationPreset[]>([]);
  const [points, setPoints] = useState<Pin[]>([]); // 描画中（未確定）の多角形の頂点
  const [name, setName] = useState("");
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  const load = () => api.getLocationPresets().then(setPresets).catch(() => {});
  useEffect(() => { load(); }, []);

  const resetForm = () => {
    setPoints([]);
    setName("");
    setEditingIndex(null);
  };

  const openEdit = () => {
    setDraft(presets);
    resetForm();
    setOpen(true);
  };
  const cancel = () => {
    setOpen(false);
    resetForm();
  };

  const selectForEdit = (i: number) => {
    const p = draft[i];
    setPoints(p.points);
    setName(p.name);
    setEditingIndex(i);
  };

  const undoPoint = () => setPoints((pts) => pts.slice(0, -1));

  const addOrUpdate = () => {
    const n = name.trim();
    if (!n) {
      toast("名前を入力してください", "error");
      return;
    }
    if (points.length < 3) {
      toast("地図をタップして3点以上でエリアを囲んでください", "error");
      return;
    }
    if (draft.some((p, i) => p.name === n && i !== editingIndex)) {
      toast("すでに同じ名前があります", "error");
      return;
    }
    setDraft((ds) => {
      const next = [...ds];
      const entry = { name: n, points };
      if (editingIndex != null) next[editingIndex] = entry;
      else next.push(entry);
      return next;
    });
    resetForm();
  };

  const remove = async (i: number) => {
    const ok = await confirm({
      title: "拾得場所プリセットの削除",
      body: `「${draft[i].name}」を削除します。登録済みの物品データは変わりません。`,
      danger: true,
      okLabel: "削除する",
    });
    if (!ok) return;
    setDraft((ds) => ds.filter((_, idx) => idx !== i));
    if (editingIndex === i) resetForm();
  };

  const save = async () => {
    setSaving(true);
    try {
      const saved = await api.updateLocationPresets(draft);
      setPresets(saved);
      toast("拾得場所プリセットを保存しました", "success");
      setOpen(false);
    } catch (e) {
      toast(`保存に失敗しました: ${(e as Error).message}`, "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Card variant="bordered">
        <div className="rb-between mb-8">
          <h3 style={{ margin: 0 }}>拾得場所プリセット</h3>
          <Button variant="outline" size="sm" onClick={openEdit}>編集</Button>
        </div>
        <p className="rb-small muted-text">
          地図上のエリアを塗りつぶして名前を付けておくと、登録・編集時にそのエリアをタップするだけで
          拾得場所と地図ピンが同時に決まります。
        </p>
        {presets.length > 0 ? (
          <div className="mt-16">
            <MapPicker value={null} readOnly regions={presets} />
          </div>
        ) : (
          <span className="rb-tiny muted-text">未設定です</span>
        )}
      </Card>

      <Modal
        open={open}
        title="拾得場所プリセットを編集"
        context="管理 › 設定"
        size="wide"
        onClose={cancel}
        footer={
          <>
            <Button variant="outline" onClick={cancel} disabled={saving}>キャンセル</Button>
            <Button onClick={save} disabled={saving}>{saving ? "保存中…" : "保存"}</Button>
          </>
        }
      >
        <div className="rb-chips mb-16">
          {draft.map((p, i) => (
            <span
              key={p.name}
              className="rb-chip"
              style={{ cursor: "pointer" }}
              onClick={() => selectForEdit(i)}
            >
              {p.name}
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); remove(i); }}
                aria-label={`${p.name} を削除`}
              >
                ×
              </button>
            </span>
          ))}
          {draft.length === 0 && <span className="rb-tiny muted-text">プリセットがありません</span>}
        </div>

        <div className="rb-between mb-8">
          <div className="rb-label" style={{ margin: 0 }}>
            地図をタップしてエリアを囲む（3点以上）
          </div>
          <div className="rb-row" style={{ gap: 4 }}>
            <Button variant="outline" size="sm" onClick={undoPoint} disabled={points.length === 0}>
              1点戻す
            </Button>
            <Button variant="outline" size="sm" onClick={() => setPoints([])} disabled={points.length === 0}>
              やり直す
            </Button>
          </div>
        </div>
        <MapPicker
          value={null}
          regions={draft}
          activeRegionName={editingIndex != null ? draft[editingIndex]?.name : undefined}
          previewPoints={points}
          onChange={(p) => p && setPoints((pts) => [...pts, p])}
        />

        <div className="rb-grid rb-grid--2 mt-16">
          <Field label="名前">
            {(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} />}
          </Field>
          <div className="rb-field" style={{ justifyContent: "flex-end" }}>
            <Button variant="outline" onClick={addOrUpdate}>
              {editingIndex != null ? "更新" : "追加"}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}

/** 種別・色の選択肢を編集する共通コンポーネント。編集はポップアップ内で行う。
 * 並び替え（↑↓）・グループ見出し・（色リストのみ）色タグを設定できる。 */
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
  const [values, setValues] = useState<MetaOption[]>([]);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<MetaOption[]>([]);
  const [name, setName] = useState("");
  const [group, setGroup] = useState("");
  const [color, setColor] = useState("");
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const supportsColor = kind === "colors";

  const load = () =>
    api.meta().then((m) => {
      setValues(kind === "categories" ? m.categories : m.colors);
    });
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const resetForm = () => {
    setName("");
    setGroup("");
    setColor("");
    setEditingIndex(null);
  };

  const openEdit = () => {
    setDraft(values);
    resetForm();
    setOpen(true);
  };
  const cancel = () => {
    setOpen(false);
    resetForm();
  };

  const selectForEdit = (i: number) => {
    const o = draft[i];
    setName(o.name);
    setGroup(o.group ?? "");
    setColor(o.color ?? "");
    setEditingIndex(i);
  };

  const addOrUpdate = () => {
    const n = name.trim();
    if (!n) {
      toast("名前を入力してください", "error");
      return;
    }
    if (draft.some((o, i) => o.name === n && i !== editingIndex)) {
      toast("すでに登録されています", "error");
      return;
    }
    const entry: MetaOption = {
      name: n,
      ...(group.trim() ? { group: group.trim() } : {}),
      ...(supportsColor && color ? { color } : {}),
    };
    setDraft((os) => {
      const next = [...os];
      if (editingIndex != null) next[editingIndex] = entry;
      else next.push(entry);
      return next;
    });
    resetForm();
  };

  const remove = async (i: number) => {
    // 既存データがその値を使っている可能性があるため、消す前に確認する
    const o = draft[i];
    const ok = await confirm({
      title: `${title}から削除`,
      body: `「${o.name}」を選択肢から削除します。\n既に登録済みの物品のデータは変更されませんが、選択肢には出なくなります。`,
      danger: true,
      okLabel: "削除する",
    });
    if (!ok) return;
    setDraft((os) => os.filter((_, idx) => idx !== i));
    if (editingIndex === i) resetForm();
  };

  const move = (i: number, dir: -1 | 1) => {
    setDraft((os) => {
      const j = i + dir;
      if (j < 0 || j >= os.length) return os;
      const next = [...os];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  };

  const save = async () => {
    setSaving(true);
    try {
      const saved = await api.updateMeta(kind, draft);
      setValues(saved);
      toast(`${title}を保存しました`, "success");
      setOpen(false);
    } catch (e) {
      toast(`保存に失敗しました: ${(e as Error).message}`, "error");
    } finally {
      setSaving(false);
    }
  };

  const groupOptions = Array.from(new Set(draft.map((o) => o.group).filter(Boolean))) as string[];

  return (
    <>
      <Card variant="bordered">
        <div className="rb-between mb-8">
          <h3 style={{ margin: 0 }}>{title}</h3>
          <Button variant="outline" size="sm" onClick={openEdit}>編集</Button>
        </div>
        <p className="rb-small muted-text">{description}</p>
        <div className="rb-chips mt-16">
          {values.map((o) => (
            <span key={o.name} className="rb-chip" style={{ gap: 6 }}>
              <ColorSwatch color={o.color} />
              {o.name}
              {o.group && <span className="rb-tiny muted-text">({o.group})</span>}
            </span>
          ))}
          {values.length === 0 && <span className="rb-tiny muted-text">項目がありません</span>}
        </div>
      </Card>

      <Modal
        open={open}
        title={`${title}を編集`}
        context="管理 › 設定"
        size="wide"
        onClose={cancel}
        footer={
          <>
            <Button variant="outline" onClick={cancel} disabled={saving}>キャンセル</Button>
            <Button onClick={save} disabled={saving}>{saving ? "保存中…" : "保存"}</Button>
          </>
        }
      >
        <div className="rb-col mb-16" style={{ gap: 4 }}>
          {draft.map((o, i) => (
            <div
              key={`${o.name}-${i}`}
              className="rb-between"
              style={{ cursor: "pointer", padding: "6px 8px", border: "var(--bw-thin, 1px) solid var(--border)" }}
              onClick={() => selectForEdit(i)}
            >
              <span className="rb-row" style={{ gap: 8 }}>
                <ColorSwatch color={o.color} />
                <strong className="rb-small">{o.name}</strong>
                {o.group && <span className="rb-tiny muted-text">{o.group}</span>}
              </span>
              <span className="rb-row" style={{ gap: 4 }} onClick={(e) => e.stopPropagation()}>
                <Button variant="outline" size="sm" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`${o.name} を上へ`}>
                  ↑
                </Button>
                <Button variant="outline" size="sm" onClick={() => move(i, 1)} disabled={i === draft.length - 1} aria-label={`${o.name} を下へ`}>
                  ↓
                </Button>
                <Button variant="destructive" size="sm" onClick={() => remove(i)} aria-label={`${o.name} を削除`}>
                  ×
                </Button>
              </span>
            </div>
          ))}
          {draft.length === 0 && <span className="rb-tiny muted-text">項目がありません</span>}
        </div>

        <div className="rb-grid rb-grid--3">
          <Field label="名前">
            {(id) => (
              <Input
                id={id}
                value={name}
                placeholder={placeholder}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  // IME 変換中の Enter は「確定」なので追加しない（半端な文字列の混入を防ぐ）
                  if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    addOrUpdate();
                  }
                }}
              />
            )}
          </Field>
          <Field label="グループ見出し" hint="任意。ドロップダウンで見出し付きにまとまる">
            {(id) => (
              <>
                <Input id={id} list={`${kind}-groups`} value={group} onChange={(e) => setGroup(e.target.value)} />
                <datalist id={`${kind}-groups`}>
                  {groupOptions.map((g) => <option key={g} value={g} />)}
                </datalist>
              </>
            )}
          </Field>
          {supportsColor ? (
            <Field label="色タグ" hint="任意。一覧・検索でスウォッチ表示に使う">
              {(id) => (
                <div className="rb-row" style={{ flexWrap: "nowrap" }}>
                  <input
                    id={id}
                    type="color"
                    value={color || "#888888"}
                    onChange={(e) => setColor(e.target.value)}
                    style={{ width: 40, height: 34, padding: 0, border: "var(--bw-thin, 1px) solid var(--border)" }}
                  />
                  {color && (
                    <Button variant="outline" size="sm" onClick={() => setColor("")}>クリア</Button>
                  )}
                </div>
              )}
            </Field>
          ) : (
            <div className="rb-field" style={{ justifyContent: "flex-end" }}>
              <Button variant="outline" onClick={addOrUpdate}>
                {editingIndex != null ? "更新" : "追加"}
              </Button>
            </div>
          )}
        </div>
        {supportsColor && (
          <div className="rb-row mt-16">
            <Button variant="outline" onClick={addOrUpdate}>
              {editingIndex != null ? "更新" : "追加"}
            </Button>
          </div>
        )}
      </Modal>
    </>
  );
}
