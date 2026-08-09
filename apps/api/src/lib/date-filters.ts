const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

function jstBoundary(value: string | undefined, endOfDay: boolean): string | undefined {
  if (!value || !DATE_ONLY_RE.test(value)) return value || undefined;
  const suffix = endOfDay ? "T23:59:59.999+09:00" : "T00:00:00.000+09:00";
  const parsed = new Date(`${value}${suffix}`);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
}

/** date入力を、DBに保存されたUTC ISO文字列と比較できるJST境界へ変換する。 */
export function normalizeFoundDateRange(
  from: string | undefined,
  to: string | undefined,
): { from?: string; to?: string } {
  return {
    from: jstBoundary(from, false),
    to: jstBoundary(to, true),
  };
}
