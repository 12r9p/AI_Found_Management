"use client";
import { useEffect, useRef, useState } from "react";

/**
 * 画面遷移をまたいで状態を保持するフック（sessionStorage）。
 *
 * 現場では「登録の途中で在庫を確認しに別画面へ行く」ような操作が頻繁に起きる。
 * 戻ってきたときに入力が消えていると再入力コストが高いので、入力・検索条件・
 * タブ位置などをセッション中は保持する。
 *
 * sessionStorage を使う理由: タブを閉じれば消えるため、共有端末に古い入力が
 * 残り続けない（個人情報を扱わない運用方針とも整合）。
 */
export function usePersistentState<T>(
  key: string,
  initial: T,
): [T, React.Dispatch<React.SetStateAction<T>>, () => void] {
  const storageKey = `found:${key}`;
  const [value, setValue] = useState<T>(initial);
  const loaded = useRef(false);

  // 初回マウント時に復元（SSR とのハイドレーション不整合を避けるため effect で）
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(storageKey);
      if (raw !== null) setValue(JSON.parse(raw) as T);
    } catch {
      /* 破損データは無視 */
    }
    loaded.current = true;
  }, [storageKey]);

  // 復元完了後のみ保存（初期値で上書きしない）
  useEffect(() => {
    if (!loaded.current) return;
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(value));
    } catch {
      /* 容量超過等は無視 */
    }
  }, [storageKey, value]);

  const clear = () => {
    try {
      sessionStorage.removeItem(storageKey);
    } catch {
      /* noop */
    }
    setValue(initial);
  };

  return [value, setValue, clear];
}
