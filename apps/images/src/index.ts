import { IMAGE_CACHE_TTL_SECONDS, IMAGE_VARIANTS, type ImageVariant } from "./variants.ts";

export type { ImageVariant } from "./variants.ts";

const IMAGE_PATH_PREFIX = "/api/images/";
const IMAGE_KEY_PATTERN =
  /^(?:img|map)_[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(?:jpg|jpeg|png|webp|gif|heic|avif|svg|pdf|bin)$/i;
const TRANSFORMABLE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp", "gif", "avif"]);

export interface ImageRequest {
  key: string;
  variant: ImageVariant;
}

export type ImageRequestParseResult =
  | { ok: true; value: ImageRequest }
  | { ok: false; response: Response };

type ImageSourceMetadata = Pick<
  R2ObjectBody,
  "httpEtag" | "size" | "httpMetadata" | "uploaded" | "writeHttpMetadata"
>;

function errorResponse(status: number, message: string, headers: HeadersInit = {}): Response {
  return new Response(message, {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "text/plain; charset=utf-8",
      ...headers,
    },
  });
}

function invalidRequest(message: string): ImageRequestParseResult {
  return { ok: false, response: errorResponse(400, message) };
}

export function parseImageRequest(request: Request): ImageRequestParseResult {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return {
      ok: false,
      response: errorResponse(405, "method not allowed", { allow: "GET, HEAD" }),
    };
  }

  const url = new URL(request.url);
  if (!url.pathname.startsWith(IMAGE_PATH_PREFIX)) {
    return invalidRequest("invalid image path");
  }

  let key: string;
  try {
    key = decodeURIComponent(url.pathname.slice(IMAGE_PATH_PREFIX.length));
  } catch {
    return invalidRequest("invalid image key");
  }
  if (!IMAGE_KEY_PATTERN.test(key)) {
    return invalidRequest("invalid image key");
  }

  const params = [...url.searchParams.keys()];
  if (params.some((name) => name !== "variant") || url.searchParams.getAll("variant").length > 1) {
    return invalidRequest("only the variant parameter is supported");
  }

  const rawVariant = url.searchParams.get("variant") ?? "original";
  if (rawVariant !== "thumb" && rawVariant !== "preview" && rawVariant !== "original") {
    return invalidRequest("unknown image variant");
  }

  return { ok: true, value: { key, variant: rawVariant } };
}

function extensionOf(key: string): string {
  return key.slice(key.lastIndexOf(".") + 1).toLowerCase();
}

function isTransformable(key: string): boolean {
  return TRANSFORMABLE_EXTENSIONS.has(extensionOf(key));
}

function contentTypeForKey(key: string): string {
  switch (extensionOf(key)) {
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "webp":
      return "image/webp";
    case "gif":
      return "image/gif";
    case "heic":
      return "image/heic";
    case "avif":
      return "image/avif";
    case "svg":
      return "image/svg+xml";
    case "pdf":
      return "application/pdf";
    default:
      return "application/octet-stream";
  }
}

function variantEtag(sourceEtag: string, variant: ImageVariant): string {
  const token = sourceEtag.replaceAll('"', "");
  return variant === "original" ? sourceEtag : `W/"${token}-${variant}"`;
}

export function imageResponseHeaders(
  source: ImageSourceMetadata,
  key: string,
  variant: ImageVariant,
  contentType: string,
  contentLength: number,
): Headers {
  const headers = new Headers();
  source.writeHttpMetadata(headers);
  headers.set("content-type", contentType || headers.get("content-type") || contentTypeForKey(key));
  headers.set("content-length", String(contentLength));
  headers.set("etag", variantEtag(source.httpEtag, variant));
  headers.set(
    "cache-control",
    `public, max-age=${IMAGE_CACHE_TTL_SECONDS}, s-maxage=${IMAGE_CACHE_TTL_SECONDS}`,
  );
  headers.set("cdn-cache-control", `public, max-age=${IMAGE_CACHE_TTL_SECONDS}`);
  headers.set("cache-tag", `image-${key}`);
  if (source.uploaded) headers.set("last-modified", source.uploaded.toUTCString());
  return headers;
}

function notModified(request: Request, etag: string): boolean {
  const ifNoneMatch = request.headers.get("if-none-match");
  if (!ifNoneMatch) return false;
  return ifNoneMatch
    .split(",")
    .some((candidate) => candidate.trim() === etag || candidate.trim() === "*");
}

async function sourceResponse(
  request: Request,
  source: R2ObjectBody,
  key: string,
  variant: ImageVariant,
) {
  const contentType = source.httpMetadata?.contentType ?? contentTypeForKey(key);
  const headers = imageResponseHeaders(source, key, variant, contentType, source.size);
  if (notModified(request, headers.get("etag")!))
    return new Response(null, { status: 304, headers });
  return new Response(request.method === "HEAD" ? null : source.body, { headers });
}

async function transformedResponse(
  request: Request,
  env: Env,
  source: R2ObjectBody,
  key: string,
  variant: Exclude<ImageVariant, "original">,
): Promise<Response> {
  const options = IMAGE_VARIANTS[variant];
  const transformed = (
    await env.IMAGE_TRANSFORMATIONS.input(source.body)
      .transform({
        width: options.width,
        ...(options.height ? { height: options.height } : {}),
        fit: options.fit,
      })
      .output({ format: "image/webp", quality: options.quality, anim: true })
  ).response();

  const contentLength = transformed.headers.get("content-length");
  let outputBuffer: ArrayBuffer | null = null;
  let length = contentLength ? Number(contentLength) : NaN;
  if (!Number.isFinite(length)) {
    const bytes = new Uint8Array(await transformed.arrayBuffer());
    outputBuffer = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(outputBuffer).set(bytes);
    length = bytes.byteLength;
  }

  const headers = imageResponseHeaders(source, key, variant, "image/webp", length);
  if (notModified(request, headers.get("etag")!))
    return new Response(null, { status: 304, headers });
  if (request.method === "HEAD") return new Response(null, { headers });
  return outputBuffer
    ? new Response(outputBuffer, { headers })
    : new Response(transformed.body, { headers });
}

export async function handleImageRequest(request: Request, env: Env): Promise<Response> {
  const parsed = parseImageRequest(request);
  if (!parsed.ok) return parsed.response;

  const { key, variant } = parsed.value;
  const source = await env.IMAGE_BUCKET.get(key);
  if (!source) return errorResponse(404, "not found");

  if (variant === "original" || !isTransformable(key)) {
    return sourceResponse(request, source, key, "original");
  }

  try {
    return await transformedResponse(request, env, source, key, variant);
  } catch (error) {
    // SVG/PDF/HEIC and malformed uploads remain usable as originals. Re-read because
    // the Images binding consumes the R2 stream before reporting a transform error.
    console.warn(
      JSON.stringify({ event: "image_transform_fallback", key, variant, error: String(error) }),
    );
    const fallback = await env.IMAGE_BUCKET.get(key);
    return fallback
      ? sourceResponse(request, fallback, key, "original")
      : errorResponse(404, "not found");
  }
}

export default {
  fetch(request, env) {
    return handleImageRequest(request, env);
  },
} satisfies ExportedHandler<Env>;
