import { resolveConfig, type Config, type Env } from "./config.ts";
import { getStore, type Store } from "./store/index.ts";
import { createAIProvider, type AIProvider } from "./ai/provider.ts";
import { createImageStorage, type ImageStorage } from "./storage/images.ts";

export interface AppContext {
  cfg: Config;
  store: Store;
  ai: AIProvider;
  images: ImageStorage;
}

export async function buildContext(env: Env = {} as Env): Promise<AppContext> {
  const cfg = resolveConfig(env);
  const store = await getStore(cfg);
  const ai = createAIProvider(cfg);
  const images = createImageStorage(cfg);
  return { cfg, store, ai, images };
}
