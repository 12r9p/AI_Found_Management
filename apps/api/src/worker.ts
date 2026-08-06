// Cloudflare Workers エントリ。R2/D1/Vectorize バインディングは env 経由で渡る。
import { createApp } from "./app.ts";
import { setEnv, setExecutionContext } from "./env-holder.ts";
import type { Env } from "./config.ts";

let app: ReturnType<typeof createApp> | undefined;

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    setEnv(env); // R2/DB バインディングを現在のリクエストコンテキストへ
    setExecutionContext(ctx); // waitUntil によるバックグラウンド処理継続のため
    // bindingを受け取ってから初期化し、module load時の環境推測でOpenAPIを公開しない。
    app ??= createApp(undefined, { openApiEnabled: env.NODE_ENV !== "production" });
    return app.fetch(request);
  },
};
