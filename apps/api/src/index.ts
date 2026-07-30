// Bun ローカル開発サーバ。`bun run dev` で起動。
import { createApp } from "./app.ts";

const app = createApp();
const port = Number((globalThis as any).process?.env?.PORT ?? 8787);

app.listen(port);
console.log(`[found-api] listening on http://localhost:${port}`);
console.log(`  health: http://localhost:${port}/api/health`);

export type { App } from "./app.ts";
