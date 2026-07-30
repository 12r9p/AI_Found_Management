-- D1 スキーマ（SQLite方言）。ベクトルは Vectorize 側（found-items / found-inquiries インデックス）に保持し、
-- ここには id と行データのみを持つ。id/created_at/updated_at はアプリ側で生成して渡す。

CREATE TABLE IF NOT EXISTS items (
  id               TEXT PRIMARY KEY,
  display_id       TEXT NOT NULL DEFAULT '',
  status           TEXT NOT NULL DEFAULT 'stored',
  category         TEXT NOT NULL DEFAULT '',
  color            TEXT NOT NULL DEFAULT '',
  brand            TEXT NOT NULL DEFAULT '',
  found_location   TEXT NOT NULL DEFAULT '',
  found_at         TEXT,
  map_key          TEXT NOT NULL DEFAULT '',
  found_x          REAL,
  found_y          REAL,
  storage_location TEXT NOT NULL DEFAULT '',
  image_keys       TEXT NOT NULL DEFAULT '[]',
  ai_description   TEXT NOT NULL DEFAULT '',
  tags             TEXT NOT NULL DEFAULT '[]',
  notes            TEXT NOT NULL DEFAULT '',
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS inquiries (
  id               TEXT PRIMARY KEY,
  status           TEXT NOT NULL DEFAULT 'open',
  description      TEXT NOT NULL DEFAULT '',
  category         TEXT NOT NULL DEFAULT '',
  color            TEXT NOT NULL DEFAULT '',
  ai_description   TEXT NOT NULL DEFAULT '',
  tags             TEXT NOT NULL DEFAULT '[]',
  reference_no     TEXT NOT NULL DEFAULT '',
  notes            TEXT NOT NULL DEFAULT '',
  matched_item_id  TEXT,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS matches (
  id          TEXT PRIMARY KEY,
  item_id     TEXT NOT NULL,
  inquiry_id  TEXT NOT NULL,
  score       REAL NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending',
  direction   TEXT NOT NULL DEFAULT 'item_to_inquiry',
  created_at  TEXT NOT NULL,
  UNIQUE (item_id, inquiry_id)
);

CREATE TABLE IF NOT EXISTS notifications (
  id             TEXT PRIMARY KEY,
  type           TEXT NOT NULL DEFAULT 'system',
  title          TEXT NOT NULL DEFAULT '',
  body           TEXT NOT NULL DEFAULT '',
  ref_item_id    TEXT,
  ref_inquiry_id TEXT,
  ref_match_id   TEXT,
  read           INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS items_status_idx ON items (status);
CREATE INDEX IF NOT EXISTS items_display_id_idx ON items (display_id);
CREATE INDEX IF NOT EXISTS items_category_idx ON items (category);
CREATE INDEX IF NOT EXISTS inquiries_status_idx ON inquiries (status);
