-- 複数拠点で現物を取り違えないよう、物品ごとの保管場所を再び保持する。
-- 既存レコードには空文字を設定し、以降の新規登録はAPIで必須入力にする。
ALTER TABLE items ADD COLUMN storage_location TEXT NOT NULL DEFAULT '';
