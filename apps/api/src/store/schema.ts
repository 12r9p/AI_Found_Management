/** pgvector を使う Postgres スキーマ（D1 ではない）。埋め込み次元は設定に追従。 */
export function schemaSql(embedDim: number): string {
  return `
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS items (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  display_id       text NOT NULL DEFAULT '',
  status           text NOT NULL DEFAULT 'stored',
  category         text NOT NULL DEFAULT '',
  color            text NOT NULL DEFAULT '',
  brand            text NOT NULL DEFAULT '',
  found_location   text NOT NULL DEFAULT '',
  found_at         timestamptz,
  map_key          text NOT NULL DEFAULT '',
  found_x          double precision,
  found_y          double precision,
  storage_location text NOT NULL DEFAULT '',
  image_keys       jsonb NOT NULL DEFAULT '[]'::jsonb,
  ai_description   text NOT NULL DEFAULT '',
  tags             jsonb NOT NULL DEFAULT '[]'::jsonb,
  embedding        vector(${embedDim}),
  notes            text NOT NULL DEFAULT '',
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS inquiries (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status           text NOT NULL DEFAULT 'open',
  description      text NOT NULL DEFAULT '',
  category         text NOT NULL DEFAULT '',
  color            text NOT NULL DEFAULT '',
  ai_description   text NOT NULL DEFAULT '',
  tags             jsonb NOT NULL DEFAULT '[]'::jsonb,
  embedding        vector(${embedDim}),
  reference_no     text NOT NULL DEFAULT '',
  notes            text NOT NULL DEFAULT '',
  matched_item_id  uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS matches (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id     uuid NOT NULL,
  inquiry_id  uuid NOT NULL,
  score       double precision NOT NULL,
  status      text NOT NULL DEFAULT 'pending',
  direction   text NOT NULL DEFAULT 'item_to_inquiry',
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (item_id, inquiry_id)
);

CREATE TABLE IF NOT EXISTS settings (
  key   text PRIMARY KEY,
  value text NOT NULL DEFAULT ''
);

-- 既存DBへの後方互換（列追加）
ALTER TABLE items ADD COLUMN IF NOT EXISTS display_id text NOT NULL DEFAULT '';
ALTER TABLE items ADD COLUMN IF NOT EXISTS map_key text NOT NULL DEFAULT '';
ALTER TABLE items ADD COLUMN IF NOT EXISTS found_x double precision;
ALTER TABLE items ADD COLUMN IF NOT EXISTS found_y double precision;

CREATE TABLE IF NOT EXISTS notifications (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type           text NOT NULL DEFAULT 'system',
  title          text NOT NULL DEFAULT '',
  body           text NOT NULL DEFAULT '',
  ref_item_id    uuid,
  ref_inquiry_id uuid,
  ref_match_id   uuid,
  read           boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- 近似最近傍インデックス（コサイン距離）
CREATE INDEX IF NOT EXISTS items_embedding_idx
  ON items USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS inquiries_embedding_idx
  ON inquiries USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS items_status_idx ON items (status);
CREATE INDEX IF NOT EXISTS items_display_id_idx ON items (display_id);
CREATE INDEX IF NOT EXISTS items_category_idx ON items (category);
CREATE INDEX IF NOT EXISTS inquiries_status_idx ON inquiries (status);
`;
}
