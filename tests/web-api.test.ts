import { afterEach, expect, test } from "bun:test";
import { ApiError, api, isAppliedApiError } from "../apps/web/lib/api";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("APIエラーはappliedを含む構造化payloadを保持する", async () => {
  globalThis.fetch = async () =>
    Response.json({ error: "vector_metadata_sync_failed", applied: true }, { status: 503 });

  try {
    await api.updateItem("item-1", { color: "茶" });
    throw new Error("ApiErrorが必要です");
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError);
    expect(isAppliedApiError(error)).toBe(true);
    expect(error).toMatchObject({
      message: "vector_metadata_sync_failed",
      status: 503,
      payload: { error: "vector_metadata_sync_failed", applied: true },
    });
  }
});
