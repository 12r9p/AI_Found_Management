// デモデータ投入。稼働中の API に対して HTTP で投入する（メモリストア対応）。
// 使い方: API を起動した状態で `bun run seed`
const BASE = (globalThis as any).process?.env?.API_BASE ?? "http://localhost:8787";

async function post(path: string, body: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${await res.text()}`);
  return res.json();
}

const inquiries = [
  {
    reference_no: "R-1001",
    category: "財布",
    color: "茶",
    description: "茶色い革の二つ折り財布。角が少し擦れている。",
  },
  {
    reference_no: "R-1002",
    category: "傘",
    color: "紺",
    description: "紺色の折りたたみ傘。持ち手は黒。",
  },
  {
    reference_no: "R-1003",
    category: "スマートフォン",
    color: "黒",
    description: "黒いスマホ。手帳型ケース付き。",
  },
];

const items = [
  {
    category: "財布",
    color: "茶",
    brand: "",
    found_location: "正面ゲート付近",
    ai_description: "茶色の革製二つ折り財布。表面に擦れあり。小銭入れ付き。",
    tags: ["茶", "財布", "革"],
  },
  {
    category: "傘",
    color: "紺",
    brand: "",
    found_location: "東駐車場",
    ai_description: "紺色の折りたたみ傘。持ち手は黒色のラバー。",
    tags: ["紺", "傘", "折りたたみ"],
  },
  {
    category: "水筒",
    color: "銀",
    brand: "",
    found_location: "休憩所",
    ai_description: "銀色のステンレス水筒。500ml程度。底に小傷。",
    tags: ["銀", "水筒", "ステンレス"],
  },
];

async function main() {
  const health = (await (await fetch(`${BASE}/api/health`)).json()) as any;
  console.log("store:", health.store, "ai:", health.ai);

  console.log("問い合わせを登録（未解決として保存）...");
  for (const inq of inquiries) {
    const r: any = await post("/api/inquiries", inq);
    console.log(`  + ${inq.reference_no} (${inq.category}) → 既存一致 ${r.matches.length}件`);
  }

  console.log("遺失物を登録（自動照合が走る）...");
  for (const it of items) {
    const r: any = await post("/api/items", it);
    const hit = r.matches.length
      ? `★一致 ${r.matches.length}件 (top ${(r.topScore * 100).toFixed(0)}%)`
      : "一致なし";
    console.log(`  + ${it.category}/${it.color} → ${hit}`);
  }

  const notifs: any = await (await fetch(`${BASE}/api/notifications`)).json();
  console.log(`通知: ${notifs.notifications.length}件`);
  console.log("完了。スタッフ画面 (探す/管理) で確認してください。");
}

main().catch((e) => {
  console.error(e);
  (globalThis as any).process?.exit?.(1);
});
