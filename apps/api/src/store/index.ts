import type { Config } from "../config.ts";
import type { Store } from "./store.ts";
import { MemoryStore } from "./memory.ts";
import { D1VectorizeStore } from "./d1.ts";

export * from "./store.ts";

// Bun のローカル開発では単一プロセスなのでストアを使い回す。
let cached: Store | null = null;
let cachedKey = "";

export async function getStore(cfg: Config): Promise<Store> {
  const usesD1 = !!(cfg.d1 && cfg.vectorizeItems && cfg.vectorizeInquiries);
  const key = usesD1 ? "d1" : "memory";
  if (cached && cachedKey === key) return cached;
  const store: Store = usesD1
    ? new D1VectorizeStore(cfg.d1!, cfg.vectorizeItems!, cfg.vectorizeInquiries!)
    : new MemoryStore();
  await store.init();
  cached = store;
  cachedKey = key;
  return store;
}
