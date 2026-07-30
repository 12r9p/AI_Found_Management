export type ItemStatus = "stored" | "returned" | "disposed" | "transferred";
export type InquiryStatus = "open" | "matched" | "resolved" | "closed";
export type MatchStatus = "pending" | "confirmed" | "rejected";

export interface IdRule {
  prefix: string;
  dateFormat: "none" | "YYYYMMDD" | "YYMMDD" | "YYYYMM";
  separator: string;
  digits: number;
  reset: "never" | "daily" | "monthly" | "yearly";
  start: number;
}

export interface Item {
  id: string;
  /** 現場・紙台帳で使う管理番号（採番ルールは設定で変更可）。 */
  display_id: string;
  status: ItemStatus;
  category: string;
  color: string;
  brand: string;
  found_location: string;
  found_at: string | null;
  map_key: string;
  found_x: number | null;
  found_y: number | null;
  image_keys: string[];
  ai_description: string;
  tags: string[];
  notes: string;
  ai_status: "pending" | "ready" | "error";
  created_at: string;
  updated_at: string;
  score?: number | null;
}

export interface Inquiry {
  id: string;
  status: InquiryStatus;
  description: string;
  category: string;
  color: string;
  ai_description: string;
  tags: string[];
  reference_no: string;
  notes: string;
  matched_item_id: string | null;
  /** ?withMatches=1 のときだけ入る照合候補（物品込み）。 */
  matches?: Match[];
  created_at: string;
  updated_at: string;
}

export interface Match {
  id: string;
  item_id: string;
  inquiry_id: string;
  score: number;
  status: MatchStatus;
  direction: "item_to_inquiry" | "inquiry_to_item";
  created_at: string;
  item?: Item | null;
  inquiry?: Inquiry | null;
}

export interface Notification {
  id: string;
  type: string;
  title: string;
  body: string;
  ref_item_id: string | null;
  ref_inquiry_id: string | null;
  ref_match_id: string | null;
  read: boolean;
  created_at: string;
}

export interface LocationPreset {
  name: string;
  x: number;
  y: number;
}

export interface Meta {
  categories: string[];
  colors: string[];
  itemStatuses: ItemStatus[];
  inquiryStatuses: InquiryStatus[];
}

export const STATUS_LABEL: Record<string, string> = {
  stored: "保管中",
  returned: "返却済",
  disposed: "廃棄",
  transferred: "移管",
  open: "未解決",
  matched: "候補あり",
  resolved: "解決",
  closed: "取下げ",
  pending: "確認待ち",
  confirmed: "一致確定",
  rejected: "不一致",
};
