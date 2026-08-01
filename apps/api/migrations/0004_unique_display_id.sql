-- 適用前にremote D1で次の重複検出を実行し、1件でも返った場合は適用を止める。
-- SELECT display_id, COUNT(*) AS count
-- FROM items
-- WHERE display_id <> ''
-- GROUP BY display_id
-- HAVING COUNT(*) > 1;

CREATE UNIQUE INDEX items_display_id_unique_idx
  ON items (display_id)
  WHERE display_id <> '';
