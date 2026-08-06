"use client";
import { Button as BaseButton } from "@base-ui/react/button";
import { useRef, useState } from "react";
import { Button, useToast } from "./ui";
import { FoundImage } from "./FoundImage";
import { api } from "../lib/api";
import { normalizeImageFiles } from "../lib/image";

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
      const normalized = await normalizeImageFiles(picked);
      const { keys: newKeys } = await api.upload(normalized);
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
        <output className="rb-busy mb-8" aria-live="polite">
          <span className="rb-spinner" aria-hidden />
          <span>画像をアップロード中…</span>
        </output>
      )}
      <div className="rb-grid rb-grid--2">
        {keys.map((k) => (
          <div key={k}>
            <FoundImage
              imageKey={k}
              variant="preview"
              alt="拾得物"
              fetchPriority="high"
              className="thumb"
            />
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
          <BaseButton
            className="dropzone"
            onClick={() => !busy && fileRef.current?.click()}
            disabled={busy}
            focusableWhenDisabled
          >
            ＋ 写真を追加
            <span className="rb-dropzone__hint rb-tiny muted-text mt-8">
              あと{max - keys.length}枚
            </span>
          </BaseButton>
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
