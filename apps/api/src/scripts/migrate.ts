// D1 スキーマ適用は wrangler の migrations 機能で行う。このスクリプトは案内のみ。
import { buildContext } from "../context.ts";

async function main() {
  const c = await buildContext();
  if (c.store.kind !== "d1") {
    console.log("D1 バインディング未設定のためメモリストアです。マイグレーション不要。");
    return;
  }
  console.log(
    "D1 のマイグレーションは wrangler で適用してください:\n" +
      "  bun --cwd apps/api run wrangler d1 migrations apply found-db --local\n" +
      "  bun --cwd apps/api run wrangler d1 migrations apply found-db --remote",
  );
}

main().catch((e) => {
  console.error(e);
  (globalThis as any).process?.exit?.(1);
});
