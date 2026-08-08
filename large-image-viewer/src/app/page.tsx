"use client";

import { useEffect, useState, useMemo } from "react";

export interface Item {
  id: string;
  display_id?: string;
  status: "stored" | "returned" | "discarded" | string;
  category: string;
  color: string;
  brand: string;
  storage_location: string;
  found_location: string;
  found_at: string | null;
  found_x: number | null;
  found_y: number | null;
  image_keys: string[];
  ai_description: string;
  created_at: string;
}

const STATUS_LABEL: Record<string, string> = {
  stored: "保管中",
  returned: "返還済",
  discarded: "処分済",
};

const DEFAULT_REMOTE_API = "https://found.s-t.work";

export default function LargeImageViewerPage() {
  const [apiBase, setApiBase] = useState("");
  const [cfToken, setCfToken] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [imageVariant, setImageVariant] = useState<"original" | "preview" | "thumb">("original");
  const [imageSize, setImageSize] = useState<number>(200); // px
  const [filterText, setFilterText] = useState("");
  const [selectedImage, setSelectedImage] = useState<string | null>(null);

  // ローカルストレージからトークン復元
  useEffect(() => {
    const savedToken = localStorage.getItem("cf_access_token");
    if (savedToken) setCfToken(savedToken);
  }, []);

  const handleTokenChange = (val: string) => {
    setCfToken(val);
    localStorage.setItem("cf_access_token", val);
  };

  const fetchItems = async () => {
    setLoading(true);
    setError("");
    try {
      let allItems: Item[] = [];
      let cursor: { createdAt: string; id: string } | null = null;
      let hasNext = true;

      const baseUrl = apiBase.replace(/\/$/, "");

      while (hasNext) {
        const params = new URLSearchParams();
        params.set("limit", "100");
        if (cursor) {
          params.set("cursorCreatedAt", cursor.createdAt);
          params.set("cursorId", cursor.id);
        }

        const endpoint = `${baseUrl}/api/items?${params.toString()}`;
        
        const headers: Record<string, string> = {
          "Accept": "application/json",
        };
        if (cfToken.trim()) {
          headers["Cf-Access-Jwt-Assertion"] = cfToken.trim();
        }

        const res = await fetch(endpoint, {
          credentials: "include",
          headers,
        });

        // ログイン画面へのリダイレクト判定
        if (res.redirected && res.url.includes("cloudflareaccess.com")) {
          throw new Error("Cloudflare Access (Zero Trust) の認証が必要です。下部のトークン入力を行ってください。");
        }

        if (!res.ok) {
          throw new Error(`APIエラー: HTTP ${res.status} (${endpoint})`);
        }

        const data = await res.json();
        allItems = [...allItems, ...(data.items || [])];

        if (data.nextCursor) {
          cursor = data.nextCursor;
        } else {
          hasNext = false;
        }
      }
      setItems(allItems);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchItems();
  }, [apiBase, cfToken]);

  const filteredItems = useMemo(() => {
    if (!filterText.trim()) return items;
    const q = filterText.toLowerCase();
    return items.filter(
      (it) =>
        (it.display_id && it.display_id.toLowerCase().includes(q)) ||
        it.category.toLowerCase().includes(q) ||
        it.color.toLowerCase().includes(q) ||
        it.brand.toLowerCase().includes(q) ||
        it.found_location.toLowerCase().includes(q) ||
        it.ai_description.toLowerCase().includes(q),
    );
  }, [items, filterText]);

  // 画像表示用コンポーネント (画像取得時の認証エラーやリダイレクトを回避するためにBlob fetchまたはトークン付きURLを処理)
  const AuthenticatedImage = ({ imageKey, size, onClick }: { imageKey: string; size: number; onClick: (url: string) => void }) => {
    const [blobUrl, setBlobUrl] = useState<string | null>(null);
    const [imgError, setImgError] = useState(false);

    useEffect(() => {
      let active = true;
      const baseUrl = apiBase.replace(/\/$/, "");
      const url = `${baseUrl}/api/images/${encodeURIComponent(imageKey)}?variant=${imageVariant}`;

      const headers: Record<string, string> = {};
      if (cfToken.trim()) {
        headers["Cf-Access-Jwt-Assertion"] = cfToken.trim();
      }

      fetch(url, { credentials: "include", headers })
        .then((res) => {
          if (!res.ok) throw new Error("Image load failed");
          return res.blob();
        })
        .then((blob) => {
          if (!active) return;
          const objectUrl = URL.createObjectURL(blob);
          setBlobUrl(objectUrl);
        })
        .catch(() => {
          if (active) setImgError(true);
        });

      return () => {
        active = false;
        if (blobUrl) URL.revokeObjectURL(blobUrl);
      };
    }, [imageKey, imageVariant, apiBase, cfToken]);

    if (imgError) {
      return <span style={{ color: "#ef4444", fontSize: 11 }}>読込失敗</span>;
    }
    if (!blobUrl) {
      return <span style={{ color: "#94a3b8", fontSize: 11 }}>読込中...</span>;
    }

    return (
      <img
        src={blobUrl}
        alt=""
        onClick={() => onClick(blobUrl)}
        style={{
          width: size,
          height: size,
          objectFit: "cover",
          border: "1px solid #333",
          borderRadius: 4,
          display: "block",
          cursor: "pointer",
          margin: "0 auto",
        }}
        title="クリックで原寸拡大"
      />
    );
  };

  return (
    <div style={{ padding: 24, background: "#fff", color: "#000", minHeight: "100vh" }}>
      {/* ヘッダー領域 */}
      <div
        style={{
          borderBottom: "3px solid #000",
          paddingBottom: 12,
          marginBottom: 16,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 12 }}>
          <div>
            <div style={{ textTransform: "uppercase", letterSpacing: 2, fontSize: 11, fontWeight: "bold" }}>
              LOST &amp; FOUND / LARGE IMAGE VIEWER
            </div>
            <h1 style={{ margin: 0, fontSize: 28, fontWeight: "bold" }}>遺失物 登録一覧（大判画像表示版）</h1>
          </div>
          <div style={{ fontSize: 12, textAlign: "right" }}>
            接続先: <strong>{apiBase || DEFAULT_REMOTE_API}</strong>
            <br />
            データ件数: <strong>{filteredItems.length}</strong> / 全 {items.length} 件
          </div>
        </div>

        {/* コントロールパネル */}
        <div
          style={{
            marginTop: 16,
            padding: 12,
            background: "#f1f5f9",
            border: "1px solid #cbd5e1",
            borderRadius: 6,
            display: "flex",
            flexDirection: "column",
            gap: 12,
            fontSize: 13,
          }}
        >
          <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "center" }}>
            <div>
              <label style={{ fontWeight: "bold", marginRight: 6 }}>API URL:</label>
              <input
                type="text"
                value={apiBase}
                placeholder={`空欄でプロキシ(${DEFAULT_REMOTE_API})`}
                onChange={(e) => setApiBase(e.target.value)}
                style={{ padding: "4px 8px", border: "1px solid #94a3b8", borderRadius: 4, width: 240, fontFamily: "monospace" }}
              />
            </div>

            <div>
              <label style={{ fontWeight: "bold", marginRight: 6 }}>画質(variant):</label>
              <select
                value={imageVariant}
                onChange={(e) => setImageVariant(e.target.value as any)}
                style={{ padding: "4px 8px", border: "1px solid #94a3b8", borderRadius: 4 }}
              >
                <option value="original">Original (元画像・高画質)</option>
                <option value="preview">Preview (中サイズ)</option>
                <option value="thumb">Thumb (サムネイル小)</option>
              </select>
            </div>

            <div>
              <label style={{ fontWeight: "bold", marginRight: 6 }}>表示サイズ: {imageSize}px</label>
              <input
                type="range"
                min="100"
                max="400"
                step="20"
                value={imageSize}
                onChange={(e) => setImageSize(Number(e.target.value))}
                style={{ verticalAlign: "middle" }}
              />
            </div>

            <div>
              <input
                type="text"
                placeholder="キーワードで絞り込み..."
                value={filterText}
                onChange={(e) => setFilterText(e.target.value)}
                style={{ padding: "4px 10px", border: "1px solid #94a3b8", borderRadius: 4, width: 180 }}
              />
            </div>

            <button
              onClick={fetchItems}
              style={{ padding: "5px 14px", background: "#000", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer", fontWeight: "bold" }}
            >
              再読み込み
            </button>
          </div>

          {/* Cloudflare Access トークン入力エリア */}
          <div style={{ paddingTop: 8, borderTop: "1px dashed #cbd5e1", display: "flex", alignItems: "center", gap: 8 }}>
            <label style={{ fontWeight: "bold", color: "#334155" }}>🔒 Cloudflare Access JWT (CF_Authorization):</label>
            <input
              type="password"
              placeholder="トークン文字列を入力（省略時はCookie参照）"
              value={cfToken}
              onChange={(e) => handleTokenChange(e.target.value)}
              style={{ padding: "4px 8px", border: "1px solid #94a3b8", borderRadius: 4, flex: 1, fontFamily: "monospace", fontSize: 12 }}
            />
            {cfToken && (
              <button
                onClick={() => handleTokenChange("")}
                style={{ padding: "4px 8px", background: "#ef4444", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer", fontSize: 11 }}
              >
                クリア
              </button>
            )}
          </div>
        </div>
      </div>

      {/* エラー表示 */}
      {error && (
        <div style={{ padding: 16, background: "#fef2f2", color: "#991b1b", border: "1px solid #fecaca", borderRadius: 6, marginBottom: 16 }}>
          <div style={{ fontWeight: "bold", fontSize: 15, marginBottom: 4 }}>通信エラーが発生しました</div>
          <div>{error}</div>

          <div style={{ marginTop: 12, padding: 12, background: "#fff", border: "1px solid #fca5a5", borderRadius: 4, fontSize: 13, color: "#1e293b" }}>
            <div style={{ fontWeight: "bold", marginBottom: 6 }}>💡 理由と対策 (Cloudflare Access 認証):</div>
            <p style={{ margin: "0 0 8px 0", lineHeight: 1.5 }}>
              `https://found.s-t.work` は Cloudflare Access で保護されています。ローカル環境 (`localhost:3000`) からのクロスドメイン通信では、ブラウザのセキュリティ仕様により認証 Cookie がブロックされます。
            </p>
            <div style={{ fontWeight: "bold", marginTop: 8, marginBottom: 4 }}>【対処手順】</div>
            <ol style={{ margin: 0, paddingLeft: 20, lineHeight: 1.6 }}>
              <li>
                <a href="https://found.s-t.work" target="_blank" rel="noreferrer" style={{ color: "#2563eb", textDecoration: "underline", fontWeight: "bold" }}>
                  https://found.s-t.work
                </a>{" "}
                を開き、DevTools (F12) ➔ 「アプリケーション(Storage)」 ➔ 「Cookie」 を開きます。
              </li>
              <li>
                <code style={{ background: "#f1f5f9", padding: "2px 4px", borderRadius: 3 }}>CF_Authorization</code> という名前の Cookie の値をコピーします。
              </li>
              <li>上記の「🔒 Cloudflare Access JWT」欄に貼り付け、「再読み込み」を押してください。</li>
            </ol>
          </div>
        </div>
      )}

      {/* ローディング表示 */}
      {loading ? (
        <div style={{ padding: 40, textAlign: "center", color: "#64748b" }}>
          データを取得中 ({DEFAULT_REMOTE_API})...
        </div>
      ) : (
        /* メインテーブル */
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr>
              {["No", "画像 (拡大表示)", "管理番号", "状態", "種別", "色", "ブランド", "拾得場所", "拾得日", "特徴"].map((h) => (
                <th
                  key={h}
                  style={{
                    background: "#000",
                    color: "#fff",
                    padding: "8px 10px",
                    textAlign: "left",
                    border: "1px solid #000",
                    whiteSpace: "nowrap",
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredItems.map((it, i) => {
              const imageKey = it.image_keys[0];

              return (
                <tr key={it.id} style={{ borderBottom: "1px solid #ccc" }}>
                  <td style={cell}>{i + 1}</td>
                  <td style={{ ...cell, width: imageSize + 16, textAlign: "center" }}>
                    {imageKey ? (
                      <AuthenticatedImage
                        imageKey={imageKey}
                        size={imageSize}
                        onClick={(url) => setSelectedImage(url)}
                      />
                    ) : (
                      <span style={{ color: "#94a3b8" }}>なし</span>
                    )}
                  </td>
                  <td style={{ ...cell, fontWeight: "bold", fontFamily: "monospace" }}>
                    {it.display_id || it.id.slice(0, 8)}
                  </td>
                  <td style={cell}>{STATUS_LABEL[it.status] || it.status}</td>
                  <td style={cell}>{it.category}</td>
                  <td style={cell}>{it.color}</td>
                  <td style={cell}>{it.brand || "—"}</td>
                  <td style={cell}>{it.found_location}</td>
                  <td style={{ ...cell, whiteSpace: "nowrap" }}>
                    {it.found_at ? new Date(it.found_at).toLocaleDateString("ja-JP") : "—"}
                  </td>
                  <td style={{ ...cell, maxWidth: 300, lineHeight: 1.4 }}>{it.ai_description}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {/* 拡大プレビューモーダル */}
      {selectedImage && (
        <div
          onClick={() => setSelectedImage(null)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.85)",
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            zIndex: 9999,
            cursor: "zoom-out",
            padding: 24,
          }}
        >
          <div style={{ position: "relative", maxWidth: "90vw", maxHeight: "90vh" }}>
            <img
              src={selectedImage}
              alt="拡大画像"
              style={{
                maxWidth: "100%",
                maxHeight: "90vh",
                objectFit: "contain",
                borderRadius: 8,
                boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.5)",
              }}
            />
            <div
              style={{
                position: "absolute",
                top: -36,
                right: 0,
                color: "#fff",
                fontSize: 14,
                fontFamily: "sans-serif",
              }}
            >
              クリックして閉じる ✕
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const cell: React.CSSProperties = {
  padding: "8px 10px",
  border: "1px solid #000",
  verticalAlign: "middle",
};
