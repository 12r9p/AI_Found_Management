// Cloudflare Workers エントリ。R2/D1/Vectorize バインディングは env 経由で渡る。
import { createApp } from "./app.ts";
import { setEnv, setExecutionContext } from "./env-holder.ts";
import type { Env } from "./config.ts";

const app = createApp();

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    setEnv(env); // R2/DB バインディングを現在のリクエストコンテキストへ
    setExecutionContext(ctx); // waitUntil によるバックグラウンド処理継続のため
    return app.fetch(request);
  },
};
