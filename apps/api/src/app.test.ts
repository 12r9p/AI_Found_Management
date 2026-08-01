import { describe, expect, test } from "bun:test";
import { createApp } from "./app.ts";
import { normalizeWebOrigin } from "./config.ts";
import { setEnv } from "./env-holder.ts";

const webOrigin = "https://found.example";

function request(headers?: HeadersInit, method = "GET") {
  setEnv({ WEB_ORIGIN: `${webOrigin}/app` });
  return createApp().handle(
    new Request("http://api.example/api/health", {
      method,
      headers,
    }),
  );
}

describe("WEB_ORIGINの正規化", () => {
  test("URLのorigin部分だけを保持する", () => {
    expect(normalizeWebOrigin("https://found.example/app?q=1#section")).toBe(webOrigin);
  });

  test("不正なURLとopaque originを拒否する", () => {
    expect(() => normalizeWebOrigin("not a URL")).toThrow();
    expect(() => normalizeWebOrigin("data:text/plain,found")).toThrow(
      "WEB_ORIGIN must be an absolute HTTP(S) origin",
    );
    expect(() => normalizeWebOrigin("ftp://found.example")).toThrow(
      "WEB_ORIGIN must be an absolute HTTP(S) origin",
    );
  });
});

describe("資格情報付きCORS", () => {
  test("正規化したWEB_ORIGINだけを許可する", async () => {
    const response = await request({ Origin: webOrigin });

    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe(webOrigin);
    expect(response.headers.get("access-control-allow-credentials")).toBe("true");
    expect(response.headers.get("vary")).toContain("Origin");
  });

  test.each(["https://attacker.example", "null"])(
    "不許可Origin %sには資格情報付きCORSヘッダーを返さない",
    async (origin) => {
      const response = await request({ Origin: origin });

      expect(response.status).toBe(200);
      expect(response.headers.has("access-control-allow-origin")).toBe(false);
      expect(response.headers.has("access-control-allow-credentials")).toBe(false);
      expect(response.headers.get("vary")).toContain("Origin");
    },
  );

  test("Originヘッダーなしの通信を維持する", async () => {
    const response = await request();

    expect(response.status).toBe(200);
    expect(response.headers.has("access-control-allow-origin")).toBe(false);
    expect(response.headers.has("access-control-allow-credentials")).toBe(false);
  });

  test("プリフライトにも同じ許可方針を適用する", async () => {
    const allowed = await request(
      {
        Origin: webOrigin,
        "Access-Control-Request-Method": "PATCH",
      },
      "OPTIONS",
    );
    const denied = await request(
      {
        Origin: "https://attacker.example",
        "Access-Control-Request-Method": "PATCH",
      },
      "OPTIONS",
    );

    expect(allowed.status).toBe(204);
    expect(allowed.headers.get("access-control-allow-origin")).toBe(webOrigin);
    expect(allowed.headers.get("access-control-allow-credentials")).toBe("true");
    expect(allowed.headers.get("access-control-allow-methods")).toBe("PATCH");
    expect(allowed.headers.get("vary")).toContain("Origin");
    expect(denied.status).toBe(204);
    expect(denied.headers.has("access-control-allow-origin")).toBe(false);
    expect(denied.headers.has("access-control-allow-credentials")).toBe(false);
    expect(denied.headers.get("vary")).toContain("Origin");
  });
});
