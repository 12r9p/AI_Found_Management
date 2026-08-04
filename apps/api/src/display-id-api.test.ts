import { expect, test } from "bun:test";
import { createApp } from "./app.ts";
import { setEnv } from "./env-holder.ts";

test("APIは管理番号の作成競合を409で返す", async () => {
  setEnv({});
  const app = createApp();
  const displayId = `TEST-${crypto.randomUUID()}`;
  const body = JSON.stringify({ display_id: displayId, image_keys: ["test-key"] });

  const first = await app.handle(
    new Request("http://api.example/api/items", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    }),
  );
  const duplicate = await app.handle(
    new Request("http://api.example/api/items", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    }),
  );

  expect(first.status).toBe(200);
  expect(duplicate.status).toBe(409);
  expect(await duplicate.json()).toEqual({ error: "duplicate_display_id" });
});

test("APIは管理番号の更新競合を409で返す", async () => {
  setEnv({});
  const app = createApp();
  const firstDisplayId = `TEST-${crypto.randomUUID()}`;
  const secondDisplayId = `TEST-${crypto.randomUUID()}`;
  const create = async (displayId: string) => {
    const response = await app.handle(
      new Request("http://api.example/api/items", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ display_id: displayId, image_keys: ["test-key"] }),
      }),
    );
    return (await response.json()) as { item: { id: string } };
  };
  await create(firstDisplayId);
  const second = await create(secondDisplayId);

  const duplicate = await app.handle(
    new Request(`http://api.example/api/items/${second.item.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ display_id: firstDisplayId }),
    }),
  );

  expect(duplicate.status).toBe(409);
  expect(await duplicate.json()).toEqual({ error: "duplicate_display_id" });
});

test("APIは画像なしの登録を400で拒否する", async () => {
  setEnv({});
  const app = createApp();

  const response = await app.handle(
    new Request("http://api.example/api/items", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ display_id: `TEST-${crypto.randomUUID()}`, image_keys: [] }),
    }),
  );

  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: "image_required" });
});
