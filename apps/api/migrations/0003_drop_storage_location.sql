-- 保管場所は現場につき1箇所しかなく、物品ごとに記録する意味がないため列を削除する。
ALTER TABLE items DROP COLUMN storage_location;
