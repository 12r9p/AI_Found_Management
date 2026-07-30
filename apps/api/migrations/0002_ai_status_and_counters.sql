-- 画像AI解析の進捗フラグ（登録直後はバックグラウンド解析待ちで "pending"）
ALTER TABLE items ADD COLUMN ai_status TEXT NOT NULL DEFAULT 'ready';

-- 管理番号などのアトミックな連番払い出し用。
-- 「読み取り→加算→書き戻し」による重複採番を避けるため、
-- settings テーブルのJSON手動管理から専用テーブル+単一UPSERT文に置き換える。
CREATE TABLE IF NOT EXISTS counters (
  name   TEXT PRIMARY KEY,
  period TEXT NOT NULL,
  next   INTEGER NOT NULL
);
