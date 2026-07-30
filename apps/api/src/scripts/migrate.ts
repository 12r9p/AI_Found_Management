// Postgres スキーマ適用。DATABASE_URL を設定して `bun run migrate`。
import { buildContext } from "../context.ts";

async function main() {
  const c = await buildContext();
  if (c.store.kind !== "postgres") {
    console.log("DATABASE_URL 未設定のためメモリストアです。マイグレーション不要。");
    return;
  }
  // buildContext 内の getStore が init() 済み（スキーマ適用済み）。
  console.log("Postgres スキーマを適用しました（items/inquiries/matches/notifications, pgvector）。");
}

main().catch((e) => {
  console.error(e);
  (globalThis as any).process?.exit?.(1);
});
