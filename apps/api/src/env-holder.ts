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
