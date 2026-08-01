"use client";
import { useEffect, useState } from "react";
import { api, imageUrl } from "../../lib/api";
import { STATUS_LABEL, type Item } from "../../lib/types";

export const dynamic = "force-dynamic";

export default function PrintPage() {
  const [items, setItems] = useState<Item[] | null>(null);
  const [printedAt] = useState(() => new Date());

  useEffect(() => {
    const q = Object.fromEntries(new URLSearchParams(location.search));
    api.listItems(q as Record<string, string>).then(({ items: loadedItems }) => {
      setItems(loadedItems);
      // 画像の読み込みが終わってから印刷ダイアログを出す（空欄で印刷されるのを防ぐ）
      const waitImages = () => {
        const imgs = Array.from(document.images);
        return Promise.all(
          imgs.map((im) =>
            im.complete
              ? Promise.resolve()
              : new Promise<void>((res) => {
                  im.addEventListener("load", () => res(), { once: true });
                  im.addEventListener("error", () => res(), { once: true });
                }),
          ),
        );
      };
      setTimeout(() => {
        waitImages().then(() => window.print());
      }, 300);
    });
  }, []);

  if (!items) return <p style={{ fontFamily: "monospace", padding: 24 }}>読込中…</p>;

  return (
    <div style={{ padding: 24, background: "#fff", color: "#000", minHeight: "100vh" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-end",
          borderBottom: "3px solid #000",
          paddingBottom: 8,
          marginBottom: 12,
        }}
      >
        <div>
          <div
            style={{
              fontFamily: "monospace",
              textTransform: "uppercase",
              letterSpacing: 2,
              fontSize: 11,
            }}
          >
            LOST &amp; FOUND / REGISTERED ITEMS
          </div>
          <h1 style={{ margin: 0, fontSize: 28 }}>遺失物 登録一覧</h1>
        </div>
        <div style={{ fontFamily: "monospace", fontSize: 12, textAlign: "right" }}>
          出力: {printedAt.toLocaleString("ja-JP")}
          <br />
          件数: {items.length}
        </div>
      </div>

      <table
        style={{ width: "100%", borderCollapse: "collapse", fontFamily: "monospace", fontSize: 11 }}
      >
        <thead>
          <tr>
            {[
              "No",
              "画像",
              "管理番号",
              "状態",
              "種別",
              "色",
              "ブランド",
              "拾得場所",
              "地図位置",
              "拾得日",
              "特徴",
            ].map((h) => (
              <th
                key={h}
                style={
                  {
                    background: "#000",
                    color: "#fff",
                    padding: "5px 6px",
                    textAlign: "left",
                    border: "1px solid #000",
                    WebkitPrintColorAdjust: "exact",
                    printColorAdjust: "exact",
                  } as any
                }
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((it, i) => (
            <tr key={it.id} style={{ pageBreakInside: "avoid" }}>
              <td style={cell}>{i + 1}</td>
              <td style={{ ...cell, width: 60 }}>
                {/* 現物照合できるよう印刷物にも写真を載せる */}
                {it.image_keys[0] ? (
                  <img
                    src={imageUrl(it.image_keys[0])}
                    alt=""
                    style={{
                      width: 54,
                      height: 54,
                      objectFit: "cover",
                      border: "1px solid #000",
                      display: "block",
                    }}
                  />
                ) : (
                  <span style={{ fontSize: 9 }}>—</span>
                )}
              </td>
              <td style={cell}>{it.display_id || it.id.slice(0, 8)}</td>
              <td style={cell}>{STATUS_LABEL[it.status]}</td>
              <td style={cell}>{it.category}</td>
              <td style={cell}>{it.color}</td>
              <td style={cell}>{it.brand}</td>
              <td style={cell}>{it.found_location}</td>
              <td style={cell}>
                {it.found_x != null && it.found_y != null
                  ? `${(it.found_x * 100).toFixed(0)},${(it.found_y * 100).toFixed(0)}`
                  : ""}
              </td>
              <td style={cell}>
                {it.found_at ? new Date(it.found_at).toLocaleDateString("ja-JP") : ""}
              </td>
              <td style={{ ...cell, maxWidth: 220 }}>{it.ai_description.slice(0, 60)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <p style={{ fontFamily: "monospace", fontSize: 10, marginTop: 16 }}>
        ※ 本一覧に個人情報は含まれません。問い合わせ者情報は紙台帳（受付番号）で管理しています。
      </p>
    </div>
  );
}

const cell: React.CSSProperties = {
  padding: "4px 6px",
  border: "1px solid #000",
  verticalAlign: "top",
};
