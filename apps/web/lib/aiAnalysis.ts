/** 現在値が未設定の場合だけ、AI解析が返した値で補完する。 */
export function fillMissingAiValue(current: string | null | undefined, inferred: string): string {
  return current?.trim() ? current : inferred;
}
