import { expect, test } from "bun:test";
import { createApp } from "./app.ts";
import type { Env } from "./config.ts";
import { setEnv } from "./env-holder.ts";

test("画像routeはService Bindingの画像Workerへ同じRequestを転送する", async () => {
  let forwarded: Request | undefined;
  const imageWorker = {
    fetch(request: Request) {
      forwarded = request;
      return Promise.resolve(
        new Response("transformed", {
          headers: { "content-type": "image/webp" },
        }),
      );
    },
  };

  setEnv({ IMAGE_WORKER: imageWorker as unknown as Fetcher } as Env);
  try {
    const request = new Request(
      "http://localhost/api/images/img_123e4567-e89b-12d3-a456-426614174000.jpg?variant=thumb",
    );
    const response = await createApp().handle(request);

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("transformed");
    expect(forwarded?.url).toBe(request.url);
    expect(forwarded?.method).toBe("GET");
  } finally {
    setEnv({});
  }
});

test("画像WorkerのService Bindingがない場合は旧R2経路へフォールバックしない", async () => {
  setEnv({});
  const response = await createApp().handle(
    new Request("http://localhost/api/images/img_123e4567-e89b-12d3-a456-426614174000.jpg"),
  );

  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: "image_worker_unavailable" });
});
