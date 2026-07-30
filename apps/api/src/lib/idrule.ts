import type { Store } from "../store/index.ts";

/** 管理番号の採番ルール。設定画面から編集する。 */
export interface IdRule {
  prefix: string; // 例: "FD-"
  dateFormat: "none" | "YYYYMMDD" | "YYMMDD" | "YYYYMM"; // 番号に含める日付
  separator: string; // 日付と連番の区切り
  digits: number; // 連番の桁数（ゼロ埋め）
  reset: "never" | "daily" | "monthly" | "yearly"; // 連番のリセット周期
  start: number; // 連番の開始値
}

export const DEFAULT_ID_RULE: IdRule = {
  prefix: "FD-",
  dateFormat: "YYYYMMDD",
  separator: "-",
  digits: 4,
  reset: "daily",
  start: 1,
};

const RULE_KEY = "id_rule";
const COUNTER_KEY = "id_counter"; // {"period":"20260729","next":5}

export function normalizeRule(input: any): IdRule {
  const r = { ...DEFAULT_ID_RULE, ...(input ?? {}) };
  const formats = ["none", "YYYYMMDD", "YYMMDD", "YYYYMM"];
  const resets = ["never", "daily", "monthly", "yearly"];
  return {
    prefix: String(r.prefix ?? "").slice(0, 16),
    dateFormat: formats.includes(r.dateFormat) ? r.dateFormat : "YYYYMMDD",
    separator: String(r.separator ?? "").slice(0, 4),
    digits: Math.max(1, Math.min(10, Number(r.digits) || 4)),
    reset: resets.includes(r.reset) ? r.reset : "daily",
    start: Math.max(0, Number(r.start) || 1),
  };
}

export async function getIdRule(store: Store): Promise<IdRule> {
  const raw = await store.getSetting(RULE_KEY);
  if (!raw) return DEFAULT_ID_RULE;
  try {
    return normalizeRule(JSON.parse(raw));
  } catch {
    return DEFAULT_ID_RULE;
  }
}

export async function setIdRule(store: Store, rule: IdRule): Promise<IdRule> {
  const r = normalizeRule(rule);
  await store.setSetting(RULE_KEY, JSON.stringify(r));
  return r;
}

function pad(n: number, len: number): string {
  return String(n).padStart(len, "0");
}

function datePart(fmt: IdRule["dateFormat"], d: Date): string {
  const y = d.getFullYear();
  const m = pad(d.getMonth() + 1, 2);
  const day = pad(d.getDate(), 2);
  switch (fmt) {
    case "YYYYMMDD": return `${y}${m}${day}`;
    case "YYMMDD": return `${String(y).slice(2)}${m}${day}`;
    case "YYYYMM": return `${y}${m}`;
    default: return "";
  }
}

/** リセット周期のキー。周期が変わったら連番を start に戻す。 */
function periodKey(reset: IdRule["reset"], d: Date): string {
  const y = d.getFullYear();
  const m = pad(d.getMonth() + 1, 2);
  const day = pad(d.getDate(), 2);
  switch (reset) {
    case "daily": return `${y}${m}${day}`;
    case "monthly": return `${y}${m}`;
    case "yearly": return `${y}`;
    default: return "all";
  }
}

/**
 * ルールに従って次の管理番号を採番する。
 * 連番は Store.nextCounter によりアトミックに払い出す（複数スタッフが
 * 同時に登録しても重複しないことを保証する。read-modify-write ではない）。
 */
export async function nextDisplayId(store: Store, now = new Date()): Promise<string> {
  const rule = await getIdRule(store);
  const period = periodKey(rule.reset, now);
  const next = await store.nextCounter(COUNTER_KEY, period, rule.start);

  const dp = datePart(rule.dateFormat, now);
  const seq = pad(next, rule.digits);
  return `${rule.prefix}${dp}${dp ? rule.separator : ""}${seq}`;
}

/** 設定画面のプレビュー用（採番せずに例を作る）。 */
export function previewId(rule: IdRule, now = new Date()): string {
  const dp = datePart(rule.dateFormat, now);
  const seq = pad(rule.start, rule.digits);
  return `${rule.prefix}${dp}${dp ? rule.separator : ""}${seq}`;
}
