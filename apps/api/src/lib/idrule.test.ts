import { test, expect } from "bun:test";
import { MemoryStore } from "../store/memory.ts";
import { nextDisplayId, setIdRule, previewId, normalizeRule, DEFAULT_ID_RULE } from "./idrule.ts";

test("既定ルールで連番が増える", async () => {
  const store = new MemoryStore();
  const day = new Date("2026-07-29T10:00:00");
  expect(await nextDisplayId(store, day)).toBe("FD-20260729-0001");
  expect(await nextDisplayId(store, day)).toBe("FD-20260729-0002");
  expect(await nextDisplayId(store, day)).toBe("FD-20260729-0003");
});

test("日次リセット: 日付が変わると連番が戻る", async () => {
  const store = new MemoryStore();
  await nextDisplayId(store, new Date("2026-07-29T23:59:00"));
  const next = await nextDisplayId(store, new Date("2026-07-30T00:01:00"));
  expect(next).toBe("FD-20260730-0001");
});

test("リセットなしなら日をまたいでも通し番号", async () => {
  const store = new MemoryStore();
  await setIdRule(store, { ...DEFAULT_ID_RULE, dateFormat: "none", reset: "never" });
  expect(await nextDisplayId(store, new Date("2026-07-29T10:00:00"))).toBe("FD-0001");
  expect(await nextDisplayId(store, new Date("2026-07-30T10:00:00"))).toBe("FD-0002");
});

test("ルール変更が採番に反映される", async () => {
  const store = new MemoryStore();
  await setIdRule(store, {
    prefix: "LOST/",
    dateFormat: "YYMMDD",
    separator: "_",
    digits: 3,
    reset: "monthly",
    start: 100,
  });
  expect(await nextDisplayId(store, new Date("2026-07-29T10:00:00"))).toBe("LOST/260729_100");
  expect(await nextDisplayId(store, new Date("2026-07-29T11:00:00"))).toBe("LOST/260729_101");
});

test("normalizeRule は不正値を丸める（範囲外は上下限にクランプ）", () => {
  const r = normalizeRule({ digits: 999, reset: "hourly", dateFormat: "bogus", start: -5 });
  expect(r.digits).toBe(10); // 上限
  expect(r.reset).toBe("daily"); // 未知の値は既定へ
  expect(r.dateFormat).toBe("YYYYMMDD");
  expect(r.start).toBe(0); // 下限（0 始まりは許容する）
  // 未指定なら既定値
  expect(normalizeRule({}).prefix).toBe(DEFAULT_ID_RULE.prefix);
});

test("previewId は採番せずに例を返す", async () => {
  const store = new MemoryStore();
  const p = previewId(DEFAULT_ID_RULE, new Date("2026-07-29T10:00:00"));
  expect(p).toBe("FD-20260729-0001");
  // プレビューを呼んでも実際の採番には影響しない
  expect(await nextDisplayId(store, new Date("2026-07-29T10:00:00"))).toBe("FD-20260729-0001");
});
