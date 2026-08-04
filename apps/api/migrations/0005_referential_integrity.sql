-- 外部キーを追加するテーブルを再構築する間だけ、制約検査をトランザクション終端まで遅延する。
PRAGMA defer_foreign_keys = TRUE;

-- 制約追加前の孤児参照を、削除またはNULL化してから新しいテーブルへ移す。
CREATE TABLE _migration_0005_affected_inquiries (
  id TEXT PRIMARY KEY
);

INSERT OR IGNORE INTO _migration_0005_affected_inquiries
SELECT matches.inquiry_id
FROM matches
INNER JOIN inquiries ON inquiries.id = matches.inquiry_id
WHERE NOT EXISTS (SELECT 1 FROM items WHERE items.id = matches.item_id);

INSERT OR IGNORE INTO _migration_0005_affected_inquiries
SELECT inquiries.id
FROM inquiries
WHERE inquiries.matched_item_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM items WHERE items.id = inquiries.matched_item_id);

DELETE FROM matches
WHERE NOT EXISTS (SELECT 1 FROM items WHERE items.id = matches.item_id)
   OR NOT EXISTS (SELECT 1 FROM inquiries WHERE inquiries.id = matches.inquiry_id);

UPDATE inquiries
SET matched_item_id = NULL
WHERE matched_item_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM items WHERE items.id = inquiries.matched_item_id);

UPDATE notifications
SET ref_item_id = NULL
WHERE ref_item_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM items WHERE items.id = notifications.ref_item_id);

UPDATE notifications
SET ref_inquiry_id = NULL
WHERE ref_inquiry_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM inquiries WHERE inquiries.id = notifications.ref_inquiry_id
  );

UPDATE notifications
SET ref_match_id = NULL
WHERE ref_match_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM matches WHERE matches.id = notifications.ref_match_id);

-- 孤児参照の影響を受けた問い合わせだけを、残っている照合から再計算する。
UPDATE inquiries
SET status = CASE
      WHEN status = 'closed' THEN 'closed'
      WHEN EXISTS (
        SELECT 1 FROM matches
        WHERE matches.inquiry_id = inquiries.id
          AND matches.status = 'confirmed'
      ) THEN 'resolved'
      WHEN EXISTS (
        SELECT 1 FROM matches
        WHERE matches.inquiry_id = inquiries.id
          AND matches.status = 'pending'
      ) THEN 'matched'
      ELSE 'open'
    END,
    matched_item_id = (
      SELECT matches.item_id FROM matches
      WHERE matches.inquiry_id = inquiries.id
        AND matches.status = 'confirmed'
      ORDER BY matches.created_at ASC, matches.id ASC
      LIMIT 1
    ),
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE id IN (SELECT id FROM _migration_0005_affected_inquiries);

DROP TABLE _migration_0005_affected_inquiries;

ALTER TABLE notifications RENAME TO notifications_without_foreign_keys;
ALTER TABLE matches RENAME TO matches_without_foreign_keys;
ALTER TABLE inquiries RENAME TO inquiries_without_foreign_keys;

CREATE TABLE inquiries (
  id               TEXT PRIMARY KEY,
  status           TEXT NOT NULL DEFAULT 'open',
  description      TEXT NOT NULL DEFAULT '',
  category         TEXT NOT NULL DEFAULT '',
  color            TEXT NOT NULL DEFAULT '',
  ai_description   TEXT NOT NULL DEFAULT '',
  tags             TEXT NOT NULL DEFAULT '[]',
  reference_no     TEXT NOT NULL DEFAULT '',
  notes            TEXT NOT NULL DEFAULT '',
  matched_item_id  TEXT REFERENCES items(id) ON DELETE SET NULL,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);

CREATE TABLE matches (
  id          TEXT PRIMARY KEY,
  item_id     TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  inquiry_id  TEXT NOT NULL REFERENCES inquiries(id) ON DELETE CASCADE,
  score       REAL NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending',
  direction   TEXT NOT NULL DEFAULT 'item_to_inquiry',
  created_at  TEXT NOT NULL,
  UNIQUE (item_id, inquiry_id)
);

CREATE TABLE notifications (
  id             TEXT PRIMARY KEY,
  type           TEXT NOT NULL DEFAULT 'system',
  title          TEXT NOT NULL DEFAULT '',
  body           TEXT NOT NULL DEFAULT '',
  ref_item_id    TEXT REFERENCES items(id) ON DELETE SET NULL,
  ref_inquiry_id TEXT REFERENCES inquiries(id) ON DELETE SET NULL,
  ref_match_id   TEXT REFERENCES matches(id) ON DELETE SET NULL,
  read           INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL
);

INSERT INTO inquiries
SELECT * FROM inquiries_without_foreign_keys;

INSERT INTO matches
SELECT * FROM matches_without_foreign_keys;

INSERT INTO notifications
SELECT * FROM notifications_without_foreign_keys;

DROP TABLE notifications_without_foreign_keys;
DROP TABLE matches_without_foreign_keys;
DROP TABLE inquiries_without_foreign_keys;

CREATE INDEX inquiries_status_idx ON inquiries (status);
CREATE INDEX inquiries_matched_item_id_idx ON inquiries (matched_item_id);
CREATE INDEX matches_item_id_idx ON matches (item_id);
CREATE INDEX matches_inquiry_id_idx ON matches (inquiry_id);
CREATE INDEX notifications_ref_item_id_idx ON notifications (ref_item_id);
CREATE INDEX notifications_ref_inquiry_id_idx ON notifications (ref_inquiry_id);
CREATE INDEX notifications_ref_match_id_idx ON notifications (ref_match_id);

PRAGMA foreign_key_check;
