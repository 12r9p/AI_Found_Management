import { beforeEach, expect, test } from "bun:test";
import { createApp } from "./app.ts";
import { setEnv } from "./env-holder.ts";

beforeEach(() => setEnv({}));

test("developmentだけでScalar UIとOpenAPI JSONを公開する", async () => {
  const develop = createApp(undefined, { openApiEnabled: true });
  const [ui, specResponse] = await Promise.all([
    develop.handle(new Request("http://localhost/openapi")),
    develop.handle(new Request("http://localhost/openapi/json")),
  ]);

  expect(ui.status).toBe(200);
  expect(ui.headers.get("content-type")).toContain("text/html");

  expect(specResponse.status).toBe(200);
  const spec = (await specResponse.json()) as {
    info: { title: string };
    paths: Record<
      string,
      Record<
        string,
        {
          summary?: string;
          description?: string;
          responses?: Record<string, unknown>;
        }
      >
    >;
    components?: { schemas?: Record<string, unknown> };
  };
  expect(spec.info.title).toBe("遺失物管理API");
  expect(spec.paths["/api/items"]?.get?.summary).toBe("遺失物を一覧取得");
  expect(spec.paths["/api/items"]?.get?.description).toContain("複合cursor");
  expect(spec.paths["/api/items"]?.get?.responses).toHaveProperty("400");
  expect(JSON.stringify(spec.components?.schemas ?? {})).not.toContain("embedding");

  const operations = Object.values(spec.paths).flatMap((path) =>
    Object.entries(path)
      .filter(([method]) => ["get", "post", "put", "patch", "delete"].includes(method))
      .map(([, operation]) => operation),
  );
  expect(operations).toHaveLength(32);
  expect(spec.paths["/api/export/items.csv"]?.get?.summary).toBe("遺失物をCSV出力");
  for (const operation of operations) {
    expect(operation.summary).toMatch(/[ぁ-んァ-ヶ一-龠]/);
    expect(operation.description).toMatch(/[ぁ-んァ-ヶ一-龠]/);
    expect(operation.responses).toHaveProperty("200");
    expect(operation.responses).toHaveProperty("400");
  }

  const production = createApp(undefined, { openApiEnabled: false });
  for (const path of ["/openapi", "/openapi/json"]) {
    const response = await production.handle(new Request(`http://localhost${path}`));
    expect(response.status).toBe(404);
  }
});

test("route schemaは不正なJSON入力をhandlerより前に400で拒否する", async () => {
  const response = await createApp().handle(
    new Request("http://localhost/api/meta/categories", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ values: "財布" }),
    }),
  );

  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: "invalid_request" });
});

test("公開DTOは内部のembeddingを返さない", async () => {
  const response = await createApp().handle(
    new Request("http://localhost/api/items", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        display_id: `CONTRACT-${crypto.randomUUID()}`,
        image_keys: ["image-key"],
        storage_location: "本部テント",
        ai_description: "黒い財布",
      }),
    }),
  );

  expect(response.status).toBe(200);
  const body = (await response.json()) as { item: Record<string, unknown> };
  expect(body.item).not.toHaveProperty("embedding");
});
