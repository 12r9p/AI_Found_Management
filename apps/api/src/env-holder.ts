import type { Env } from "./config.ts";

// Workers では fetch ごとに env（バインディング含む）が渡る。
// Elysia アプリは一度だけ生成するため、現在の env をモジュールに保持する。
let current: Env = {} as Env;
export function setEnv(env: Env) {
  current = env;
}
export function getEnv(): Env {
  return current;
}

// レスポンス送出後もリクエスト単位の非同期処理（画像キャッシュ書き込み、
// 登録直後のバックグラウンドAI解析など）を継続させるための ExecutionContext。
// Bun ローカル開発には存在しないため null もあり得る。
let currentCtx: ExecutionContext | null = null;
export function setExecutionContext(ctx: ExecutionContext | null) {
  currentCtx = ctx;
}
/** Workers ではレスポンスを止めずに継続実行、Bunではその場で実行する（fire-and-forget）。 */
export function waitUntil(promise: Promise<unknown>): void {
  if (currentCtx) {
    currentCtx.waitUntil(promise);
  } else {
    promise.catch((e) => console.error("[waitUntil]", e));
  }
}
