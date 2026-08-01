import { format, isValid, parse, parseISO } from "date-fns";
import { check, pipe, safeParse, string, transform } from "valibot";

const DATETIME_LOCAL_FORMAT = "yyyy-MM-dd'T'HH:mm";
const INVALID_DATETIME_MESSAGE = "拾得日時が不正です";

const dateTimeLocalSchema = pipe(
  string(),
  transform((value) => ({
    date: parse(value, DATETIME_LOCAL_FORMAT, new Date(0)),
    value,
  })),
  check(
    ({ date, value }) => isValid(date) && format(date, DATETIME_LOCAL_FORMAT) === value,
    INVALID_DATETIME_MESSAGE,
  ),
);

/** APIのISO日時をdatetime-localへ表示できるローカル時刻へ変換する。 */
export function formatIsoForDateTimeLocal(value: string | null | undefined): string {
  if (!value) return "";

  const date = parseISO(value);
  return isValid(date) ? format(date, DATETIME_LOCAL_FORMAT) : "";
}

/** datetime-localの入力を検証し、APIへ送るISO日時へ変換する。 */
export function parseDateTimeLocalToIso(value: string): string | null {
  const normalizedValue = value.trim();
  if (!normalizedValue) return null;

  const result = safeParse(dateTimeLocalSchema, normalizedValue);
  if (!result.success) {
    throw new RangeError(result.issues[0]?.message ?? INVALID_DATETIME_MESSAGE);
  }

  return result.output.date.toISOString();
}

/** 現在から指定した分数だけ前の時刻をdatetime-local用に整形する。 */
export function formatMinutesAgoForDateTimeLocal(minutes: number, now = Date.now()): string {
  return format(new Date(now - minutes * 60_000), DATETIME_LOCAL_FORMAT);
}
