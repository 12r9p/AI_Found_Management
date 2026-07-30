"use client";
import { useRef, useState } from "react";
import { Button, useToast } from "./ui";
import { api, imageUrl } from "../lib/api";

/**
 * 編集画面共通の画像アップローダー。
 * 登録画面と同じ操作感（追加・削除・最大枚数）を、既存物品の編集でも使えるようにする。
 */
export function ImageEditor({
  keys,
  onChange,
  max = 2,
  disabled,
}: {
  keys: string[];
  onChange: (keys: string[]) => void;
  max?: number;
  disabled?: boolean;
}) {
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const onPick = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const picked = Array.from(files).slice(0, max - keys.length);
    if (picked.length === 0) {
      toast(`画像は最大${max}枚までです`, "error");
      return;
    }
    setUploading(true);
    try {
      const { keys: newKeys } = await api.upload(picked);
      onChange([...keys, ...newKeys].slice(0, max));
    } catch (e) {
      toast(`アップロード失敗: ${(e as Error).message}`, "error");
    } finally {
      setUploading(false);
    }
  };

  const remove = (k: string) => onChange(keys.filter((x) => x !== k));
  const busy = uploading || disabled;

  return (
    <div>
      {uploading && (
        <div className="rb-busy mb-8" role="status" aria-live="polite">
          <span className="rb-spinner" aria-hidden />
          <span>画像をアップロード中…</span>
        </div>
      )}
      <div className="rb-grid rb-grid--2">
        {keys.map((k) => (
          <div key={k}>
            <img src={imageUrl(k)} alt="拾得物" className="thumb" />
            <Button
              variant="destructive"
              size="sm"
              block
              className="mt-8"
              onClick={() => remove(k)}
              disabled={busy}
            >
              削除
            </Button>
          </div>
        ))}
        {keys.length < max && (
          <div
            className="dropzone"
            onClick={() => !busy && fileRef.current?.click()}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && !busy && fileRef.current?.click()}
          >
            ＋ 写真を追加
            <div className="rb-tiny muted-text mt-8">
              あと{max - keys.length}枚
            </div>
          </div>
        )}
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        disabled={busy}
        onChange={(e) => {
          onPick(e.target.files);
          e.target.value = ""; // 同じ画像の再選択を許可
        }}
      />
    </div>
  );
}
