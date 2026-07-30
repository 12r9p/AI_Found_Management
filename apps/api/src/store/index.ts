import type { Config } from "../config.ts";
import type { Store } from "./store.ts";
import { MemoryStore } from "./memory.ts";
import { PgStore } from "./postgres.ts";

export * from "./store.ts";

// Bun のローカル開発では単一プロセスなのでストアを使い回す。
let cached: Store | null = null;
let cachedKey = "";

export async function getStore(cfg: Config): Promise<Store> {
  const key = cfg.databaseUrl ?? "memory";
  if (cached && cachedKey === key) return cached;
  const store: Store = cfg.databaseUrl
    ? new PgStore(cfg.databaseUrl, cfg.ai.embedDim)
    : new MemoryStore();
  await store.init();
  cached = store;
  cachedKey = key;
  return store;
}
