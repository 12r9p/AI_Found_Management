/// <reference types="bun" />

import { expect, test } from "bun:test";
import {
  formatIsoForDateTimeLocal,
  formatMinutesAgoForDateTimeLocal,
  parseDateTimeLocalToIso,
} from "./datetime";

const isTokyo = Intl.DateTimeFormat().resolvedOptions().timeZone === "Asia/Tokyo";

test("JSTの15:00をdatetime-local値へ変換する", () => {
  const localValue = "2026-01-15T15:00";
  const iso = parseDateTimeLocalToIso(localValue);

  expect(formatIsoForDateTimeLocal(iso)).toBe(localValue);
  if (isTokyo) expect(iso).toBe("2026-01-15T06:00:00.000Z");
});

test("UTCとの日付境界を越えてもローカル日付を使う", () => {
  const localValue = "2026-01-16T01:30";
  const iso = parseDateTimeLocalToIso(localValue);

  expect(formatIsoForDateTimeLocal(iso)).toBe(localValue);
  expect(formatMinutesAgoForDateTimeLocal(0, new Date(2026, 0, 15, 23, 59).getTime())).toBe(
    "2026-01-15T23:59",
  );
  if (isTokyo) expect(iso).toBe("2026-01-15T16:30:00.000Z");
});

test("既存のUTC ISOをローカルなdatetime-local値へ表示する", () => {
  const iso = "2026-08-04T05:28:00.000Z";

  expect(formatIsoForDateTimeLocal(iso)).toBe(isTokyo ? "2026-08-04T14:28" : "2026-08-04T05:28");
});

test("不正な日時を拒否する", () => {
  expect(() => parseDateTimeLocalToIso("2026-02-30T15:00")).toThrow("拾得日時が不正です");
  expect(() => parseDateTimeLocalToIso("not-a-date")).toThrow("拾得日時が不正です");
  expect(formatIsoForDateTimeLocal("not-a-date")).toBe("");
});

test("ローカル値をISOへ変換しても同じ表示値へ戻る", () => {
  const localValue = "2026-01-15T15:00";
  const iso = parseDateTimeLocalToIso(localValue);

  expect(formatIsoForDateTimeLocal(iso)).toBe(localValue);
  if (isTokyo) expect(iso).toBe("2026-01-15T06:00:00.000Z");
});

test("空のdatetime-local値をnullへ変換する", () => {
  expect(parseDateTimeLocalToIso("")).toBeNull();
  expect(parseDateTimeLocalToIso("   ")).toBeNull();
});
