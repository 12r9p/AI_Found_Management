import { describe, expect, test } from "bun:test";
import { handleImageRequest, parseImageRequest } from "./index.ts";
import { IMAGE_CACHE_TTL_SECONDS, IMAGE_VARIANTS } from "./variants.ts";

const key = "img_123e4567-e89b-12d3-a456-426614174000.jpg";
const svgKey = "map_123e4567-e89b-12d3-a456-426614174000.svg";

function fakeObject(contentType: string, body: Uint8Array, httpEtag = '"source"') {
  return {
    key,
    version: "version",
    size: body.byteLength,
    etag: httpEtag.replaceAll('"', ""),
    httpEtag,
    uploaded: new Date("2026-08-05T00:00:00Z"),
    httpMetadata: { contentType },
    storageClass: "Standard",
    body: new Response(body).body!,
    writeHttpMetadata(headers: Headers) {
      headers.set("content-type", contentType);
    },
  } as unknown as R2ObjectBody;
}

function fakeEnv(objects: Array<R2ObjectBody | null>, output?: Response | Error) {
  let getCount = 0;
  const bucket = {
    get: async () => objects[getCount++] ?? null,
  };
  const transformer = {
    input() {
      return {
        transform() {
          return this;
        },
        output: async () => {
          if (output instanceof Error) throw output;
          return { response: () => output ?? new Response("transformed") };
        },
      };
    },
  };
  return {
    env: { IMAGE_BUCKET: bucket, IMAGE_TRANSFORMATIONS: transformer } as unknown as Env,
    getCount: () => getCount,
  };
}

describe("画像URLの固定variant", () => {
  test("variantを解決し、既定値はoriginalにする", () => {
    expect(parseImageRequest(new Request(`https://found.s-t.work/api/images/${key}`))).toEqual({
      ok: true,
      value: { key, variant: "original" },
    });
    expect(
      parseImageRequest(new Request(`https://found.s-t.work/api/images/${key}?variant=thumb`)),
    ).toEqual({
      ok: true,
      value: { key, variant: "thumb" },
    });
  });

  test("thumb/previewの変換値とTTLを固定する", () => {
    expect(IMAGE_VARIANTS.thumb).toEqual({ width: 256, height: 256, fit: "cover", quality: 78 });
    expect(IMAGE_VARIANTS.preview).toEqual({
      width: 960,
      height: 960,
      fit: "scale-down",
      quality: 84,
    });
    expect(IMAGE_CACHE_TTL_SECONDS).toBe(604800);
  });

  test("任意の幅・品質、未知variant、path traversalを拒否する", () => {
    for (const url of [
      `https://found.s-t.work/api/images/${key}?variant=thumb&width=512`,
      `https://found.s-t.work/api/images/${key}?variant=large`,
      "https://found.s-t.work/api/images/../secret.jpg?variant=original",
      "https://found.s-t.work/api/images/img_123e4567-e89b-12d3-a456-426614174000.jpg/other",
    ]) {
      const result = parseImageRequest(new Request(url));
      expect(result.ok).toBe(false);
    }
  });

  test("GET/HEADだけを受け付ける", () => {
    const result = parseImageRequest(
      new Request(`https://found.s-t.work/api/images/${key}`, { method: "POST" }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.headers.get("allow")).toBe("GET, HEAD");
  });

  test("HEADは原本のETag、Content-Length、1週間TTLを返す", async () => {
    const fixture = fakeEnv([fakeObject("image/jpeg", new Uint8Array([1, 2, 3, 4]))]);
    const response = await handleImageRequest(
      new Request(`https://found.s-t.work/api/images/${key}?variant=original`, {
        method: "HEAD",
      }),
      fixture.env,
    );

    expect(response.status).toBe(200);
    expect(response.body).toBeNull();
    expect(response.headers.get("content-length")).toBe("4");
    expect(response.headers.get("etag")).toBe('"source"');
    expect(response.headers.get("cache-control")).toBe("public, max-age=604800, s-maxage=604800");
  });

  test("存在しないkeyはキャッシュしない404にする", async () => {
    const fixture = fakeEnv([null]);
    const response = await handleImageRequest(
      new Request(`https://found.s-t.work/api/images/${key}?variant=thumb`),
      fixture.env,
    );

    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  test("未対応形式はImages変換を呼ばず原本へフォールバックする", async () => {
    const fixture = fakeEnv([fakeObject("image/svg+xml", new Uint8Array([60, 62]))]);
    const response = await handleImageRequest(
      new Request(`https://found.s-t.work/api/images/${svgKey}?variant=thumb`),
      fixture.env,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/svg+xml");
    expect(fixture.getCount()).toBe(1);
  });

  test("変換成功時はWebPと変換variantのETagを返す", async () => {
    const fixture = fakeEnv(
      [fakeObject("image/jpeg", new Uint8Array([1, 2, 3, 4]), '"source"')],
      new Response(new Uint8Array([9, 8, 7]), { headers: { "content-type": "image/webp" } }),
    );
    const response = await handleImageRequest(
      new Request(`https://found.s-t.work/api/images/${key}?variant=thumb`),
      fixture.env,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/webp");
    expect(response.headers.get("content-length")).toBe("3");
    expect(response.headers.get("etag")).toBe('W/"source-thumb"');
  });

  test("変換失敗時はR2原本へ戻す", async () => {
    const fixture = fakeEnv(
      [
        fakeObject("image/jpeg", new Uint8Array([1, 2, 3, 4])),
        fakeObject("image/jpeg", new Uint8Array([5, 6])),
      ],
      new Error("unsupported source"),
    );
    const response = await handleImageRequest(
      new Request(`https://found.s-t.work/api/images/${key}?variant=preview`),
      fixture.env,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(response.headers.get("content-length")).toBe("2");
    expect(fixture.getCount()).toBe(2);
  });
});
