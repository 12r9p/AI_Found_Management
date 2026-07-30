// 環境変数の解決。Bun (process.env) と Cloudflare Workers (env binding) の両対応。

export interface Env {
  DATABASE_URL?: string;
  AI_API_KEY?: string;
  AI_BASE_URL?: string;
  AI_VISION_MODEL?: string;
  AI_EMBED_MODEL?: string;
  AI_EFFORT?: string;
  EMBED_DIM?: string;
  MATCH_THRESHOLD?: string;
  WEB_ORIGIN?: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  // Cloudflare バインディング
  IMAGES?: R2Bucket;
  HYPERDRIVE?: { connectionString: string };
}

export interface Config {
  databaseUrl: string | null;
  ai: {
    apiKey: string | null;
    baseUrl: string;
    visionModel: string;
    embedModel: string;
    effort: string;
    embedDim: number;
  };
  matchThreshold: number;
  webOrigin: string;
  r2: R2Bucket | null;
  /** Cloudflare Access 検証設定。両方揃った時のみ検証が有効。 */
  access: { teamDomain: string | null; aud: string | null; enabled: boolean };
}

export function resolveConfig(env: Env = {} as Env): Config {
  // Workers では env、Bun では process.env をマージ
  const p = (globalThis as any).process?.env ?? {};
  const get = (k: keyof Env): string | undefined =>
    (env[k] as string | undefined) ?? p[k];

  const databaseUrl =
    env.HYPERDRIVE?.connectionString ?? get("DATABASE_URL") ?? null;

  return {
    databaseUrl: databaseUrl && databaseUrl.length > 0 ? databaseUrl : null,
    ai: {
      apiKey: get("AI_API_KEY") ?? null,
      baseUrl: get("AI_BASE_URL") ?? "https://api.openai.com/v1",
      visionModel: get("AI_VISION_MODEL") ?? "gpt-5.6-luna",
      embedModel: get("AI_EMBED_MODEL") ?? "text-embedding-3-small",
      effort: get("AI_EFFORT") ?? "low",
      embedDim: parseInt(get("EMBED_DIM") ?? "1536", 10),
    },
    matchThreshold: parseFloat(get("MATCH_THRESHOLD") ?? "0.5"),
    webOrigin: get("WEB_ORIGIN") ?? "http://localhost:3000",
    r2: env.IMAGES ?? null,
    access: (() => {
      const teamDomain = get("ACCESS_TEAM_DOMAIN") || null;
      const aud = get("ACCESS_AUD") || null;
      return { teamDomain, aud, enabled: !!(teamDomain && aud) };
    })(),
  };
}
