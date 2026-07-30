/**
 * Cloudflare Access (Zero Trust) の JWT 検証。
 *
 * Access はアプリ手前で認証し、`Cf-Access-Jwt-Assertion` ヘッダに署名付き JWT を付与する。
 * Worker の URL を直接叩かれるケース（*.workers.dev への直アクセス等）を塞ぐため、
 * API 側でもこの JWT を検証する＝多層防御。
 *
 * ACCESS_TEAM_DOMAIN と ACCESS_AUD の両方が設定されている場合のみ有効。
 * ローカル開発では未設定なので素通し（従来どおり動作）。
 */

interface Jwk {
  kid: string;
  kty: string;
  alg: string;
  use?: string;
  n: string;
  e: string;
}

let cachedKeys: { keys: Jwk[]; fetchedAt: number; url: string } | null = null;
const JWKS_TTL_MS = 60 * 60 * 1000; // 1時間

async function getKeys(teamDomain: string): Promise<Jwk[]> {
  const url = `https://${teamDomain}/cdn-cgi/access/certs`;
  const now = Date.now();
  if (cachedKeys && cachedKeys.url === url && now - cachedKeys.fetchedAt < JWKS_TTL_MS) {
    return cachedKeys.keys;
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`JWKS fetch failed: ${res.status}`);
  const data = (await res.json()) as { keys: Jwk[] };
  cachedKeys = { keys: data.keys ?? [], fetchedAt: now, url };
  return cachedKeys.keys;
}

function b64urlToBytes(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const b64 = (s + pad).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function decodeJson(seg: string): any {
  return JSON.parse(new TextDecoder().decode(b64urlToBytes(seg)));
}

export interface AccessIdentity {
  email?: string;
  sub?: string;
}

/**
 * @returns 検証済み ID（有効時） / null（Access 未設定＝検証スキップ）
 * @throws 検証失敗時
 */
export async function verifyAccessJwt(
  token: string | null,
  teamDomain: string,
  aud: string,
): Promise<AccessIdentity> {
  if (!token) throw new Error("missing Cf-Access-Jwt-Assertion");
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("malformed JWT");
  const [h, p, s] = parts;

  const header = decodeJson(h);
  if (header.alg !== "RS256") throw new Error(`unsupported alg: ${header.alg}`);

  const keys = await getKeys(teamDomain);
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) throw new Error("signing key not found");

  const key = await crypto.subtle.importKey(
    "jwk",
    { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const ok = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    b64urlToBytes(s),
    new TextEncoder().encode(`${h}.${p}`),
  );
  if (!ok) throw new Error("bad signature");

  const payload = decodeJson(p);
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && now >= payload.exp) throw new Error("token expired");
  if (payload.nbf && now < payload.nbf) throw new Error("token not yet valid");
  if (payload.iss !== `https://${teamDomain}`) throw new Error("issuer mismatch");
  const auds: string[] = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!auds.includes(aud)) throw new Error("audience mismatch");

  return { email: payload.email, sub: payload.sub };
}
