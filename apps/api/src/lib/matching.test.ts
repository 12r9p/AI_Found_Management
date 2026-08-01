import { test, expect } from "bun:test";
import { MemoryStore } from "../store/memory.ts";
import { deterministicEmbed } from "../ai/provider.ts";
import { matchNewItem, matchNewInquiry, rematchPage } from "./matching.ts";
import type { AIProvider } from "../ai/provider.ts";
import { createApp } from "../app.ts";
import { setEnv } from "../env-holder.ts";
import type { Env } from "../config.ts";

const DIM = 512;
const embed = (t: string) => deterministicEmbed(t, DIM);

async function seedInquiry(store: MemoryStore, category: string, desc: string, ref: string) {
  const inq = await store.createInquiry({
    status: "open",
    category,
    description: desc,
    ai_description: desc,
    embedding: embed(`${category} ${desc}`),
    reference_no: ref,
  });
  inq.embedding = embed(`${category} ${desc}`);
  return inq;
}

test("新規遺失物が未解決問い合わせに一致し、通知が作られる", async () => {
  const store = new MemoryStore();
  await seedInquiry(store, "傘", "紺色の折りたたみ傘。持ち手は黒。", "R-1");

  const desc = "紺色の折りたたみ傘。持ち手は黒色のラバー。";
  const item = await store.createItem({
    status: "stored",
    category: "傘",
    color: "紺",
    ai_description: desc,
    embedding: embed(`傘 紺 ${desc}`),
  });
  item.embedding = embed(`傘 紺 ${desc}`);

  const out = await matchNewItem(store, item, 0.5);
  expect(out.matches.length).toBe(1);
  expect((await store.listNotifications()).length).toBe(1);
  // 問い合わせは matched に遷移
  expect((await store.listInquiries("matched")).length).toBe(1);
});

test("同じ組み合わせでは再通知しない（物品を編集しても通知が増えない）", async () => {
  const store = new MemoryStore();
  await seedInquiry(store, "傘", "紺色の折りたたみ傘。持ち手は黒。", "R-1");

  const desc = "紺色の折りたたみ傘。持ち手は黒色のラバー。";
  const text = `傘 紺 ${desc}`;
  const item = await store.createItem({
    status: "stored",
    category: "傘",
    color: "紺",
    ai_description: desc,
    embedding: embed(text),
  });
  item.embedding = embed(text);

  const first = await matchNewItem(store, item, 0.5);
  expect(first.matches.length).toBe(1);
  expect((await store.listNotifications()).length).toBe(1);

  // 物品を編集 → 再照合が走っても通知は増えない
  const second = await matchNewItem(store, item, 0.5);
  expect(second.matches.length).toBe(0);
  expect((await store.listNotifications()).length).toBe(1);
});

test("カテゴリ整合ガード: 種別が違えば一致させない", async () => {
  const store = new MemoryStore();
  await seedInquiry(store, "財布", "茶色い革の二つ折り財布。", "R-2");

  const desc = "紺色の折りたたみ傘。";
  const item = await store.createItem({
    status: "stored",
    category: "傘",
    ai_description: desc,
    embedding: embed(`傘 ${desc}`),
  });
  item.embedding = embed(`傘 ${desc}`);

  const out = await matchNewItem(store, item, 0.3); // 低しきい値でもガードで弾く
  expect(out.matches.length).toBe(0);
});

test("該当なしの問い合わせは open のまま保存され、後日の登録で照合される", async () => {
  const store = new MemoryStore();
  // まだ物品なし → 問い合わせは open
  const inq = await store.createInquiry({
    status: "open",
    category: "水筒",
    description: "銀色のステンレス水筒。",
    ai_description: "銀色のステンレス水筒。",
    embedding: embed("水筒 銀色のステンレス水筒"),
    reference_no: "R-3",
  });
  inq.embedding = embed("水筒 銀色のステンレス水筒");
  const first = await matchNewInquiry(store, inq, 0.5);
  expect(first.matches.length).toBe(0);
  expect((await store.listInquiries("open")).length).toBe(1);

  // 後日、一致する遺失物を登録 → 自動照合＆通知
  const item = await store.createItem({
    status: "stored",
    category: "水筒",
    ai_description: "銀色のステンレス水筒。500ml。",
    embedding: embed("水筒 銀色のステンレス水筒 500ml"),
  });
  item.embedding = embed("水筒 銀色のステンレス水筒 500ml");
  const out = await matchNewItem(store, item, 0.5);
  expect(out.matches.length).toBe(1);
  expect((await store.listNotifications(true)).length).toBe(1);
});

/** rematchPage は embedding を再取得するだけなので、embed だけ実装したスタブで足りる。 */
function embedOnlyProvider(): AIProvider {
  return {
    name: "test-embed-only",
    async describeImages() {
      throw new Error("not used by rematchPage");
    },
    async embed(text: string) {
      return embed(text);
    },
    async chat() {
      return "";
    },
  };
}

test("再照合ページは保管中の物品を再埋め込みし、当時見つからなかった一致も拾い直す", async () => {
  const store = new MemoryStore();
  const ai = embedOnlyProvider();

  const desc = "紺色の折りたたみ傘。持ち手は黒。";
  await store.createItem({
    status: "stored",
    category: "傘",
    color: "紺",
    ai_description: desc,
    embedding: embed(`傘 紺 ${desc}`),
  });
  await store.createInquiry({
    status: "open",
    category: "傘",
    description: desc,
    ai_description: desc,
    reference_no: "R-9",
    embedding: embed(`傘 ${desc}`),
  });
  // ここでは matchNewItem/matchNewInquiry を一切呼んでいないため、
  // 一致は存在しない状態（＝しきい値変更などで見逃されたケースを模している）。

  const outcome = await rematchPage(store, ai, 0.5);
  expect(outcome.itemsChecked).toBe(1);
  expect(outcome.matchesFound).toBe(1);
  expect(outcome.done).toBe(true);
  expect(outcome.nextCursor).toBeNull();
  expect((await store.listNotifications()).length).toBe(1);

  // 保管中でない物品は対象外
  const returned = await store.createItem({
    status: "returned",
    category: "鍵",
    embedding: embed("鍵"),
  });
  const outcome2 = await rematchPage(store, ai, 0.5);
  expect(outcome2.itemsChecked).toBe(1); // returned は数えない
  expect(outcome2.matchesFound).toBe(0); // 既知の組み合わせなので再通知しない
  void returned;
});

test("再照合ページは1件のembed失敗で残りを巻き込んで中断しない", async () => {
  const store = new MemoryStore();
  const failing: AIProvider = {
    name: "always-fails",
    async describeImages() {
      throw new Error("not used");
    },
    async embed() {
      throw new Error("model_not_found: text-embedding-3-small へのアクセス権がありません");
    },
    async chat() {
      return "";
    },
  };

  await store.createItem({ status: "stored", category: "傘", embedding: embed("傘") });
  await store.createItem({ status: "stored", category: "水筒", embedding: embed("水筒") });
  await store.createItem({ status: "stored", category: "財布", embedding: embed("財布") });

  const outcome = await rematchPage(store, failing, 0.5);
  expect(outcome.itemsChecked).toBe(3);
  expect(outcome.failed).toBe(3); // 3件とも失敗するが、途中で処理が止まらず3件とも試行される
  expect(outcome.matchesFound).toBe(0);

  // 失敗した物品は ai_status:error になり、成功時に上書きされていた古い状態が残らない
  const { items } = await store.listItems({});
  expect(items.every((it) => it.ai_status === "error")).toBe(true);
});

test("再照合ページは同じ作成日時の1,001件を100件以下ずつ終端まで処理する", async () => {
  const store = new MemoryStore();
  const ai = embedOnlyProvider();
  const createdAt = "2026-08-01T09:00:00.000Z";
  for (let index = 0; index < 1_001; index++) {
    const item = await store.createItem({ status: "stored", category: "傘" });
    await store.updateItem(item.id, { created_at: createdAt });
  }

  let cursor: string | undefined;
  let itemsChecked = 0;
  let pages = 0;
  do {
    const outcome = await rematchPage(store, ai, 0.5, cursor);
    expect(outcome.itemsChecked).toBeLessThanOrEqual(100);
    itemsChecked += outcome.itemsChecked;
    pages++;
    cursor = outcome.nextCursor ?? undefined;
    expect(outcome.done).toBe(!cursor);
  } while (cursor);

  expect(itemsChecked).toBe(1_001);
  expect(pages).toBe(11);
});

test("再照合を途中から再開しても一致候補と通知を重複させない", async () => {
  const store = new MemoryStore();
  const ai = embedOnlyProvider();
  const description = "紺色の折りたたみ傘。持ち手は黒。";
  const createdAt = "2026-08-01T09:00:00.000Z";
  await store.createInquiry({
    status: "open",
    category: "傘",
    description,
    ai_description: description,
    embedding: embed(`傘 ${description}`),
    reference_no: "R-10",
  });
  for (let index = 0; index < 101; index++) {
    const item = await store.createItem({
      status: "stored",
      category: "傘",
      ai_description: description,
      embedding: embed(`傘 ${description}`),
    });
    await store.updateItem(item.id, { created_at: createdAt });
  }

  const first = await rematchPage(store, ai, 0, undefined);
  expect(first.itemsChecked).toBe(100);
  expect(first.done).toBe(false);
  const terminal = await rematchPage(store, ai, 0, first.nextCursor!);
  expect(terminal.itemsChecked).toBe(1);
  expect(terminal.done).toBe(true);
  expect(first.matchesFound + terminal.matchesFound).toBe(101);
  expect(await store.listMatches()).toHaveLength(101);
  expect(await store.listNotifications()).toHaveLength(101);

  const resumed = await rematchPage(store, ai, 0, first.nextCursor!);
  const repeated = await rematchPage(store, ai, 0, undefined);
  expect(resumed.matchesFound).toBe(0);
  expect(repeated.matchesFound).toBe(0);
  expect(await store.listMatches()).toHaveLength(101);
  expect(await store.listNotifications()).toHaveLength(101);
});

test("POST /api/rematchは不正カーソルを400で返す", async () => {
  setEnv({} as Env);
  const response = await createApp().handle(
    new Request("http://localhost/api/rematch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cursor: "not-a-cursor" }),
    }),
  );

  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: "invalid_cursor" });
});
