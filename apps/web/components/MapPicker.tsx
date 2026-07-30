"use client";
import { useEffect, useRef, useState } from "react";
import { api, imageUrl } from "../lib/api";
import { Button } from "./ui";

export interface Pin {
  x: number; // 0..1
  y: number; // 0..1
}

/**
 * 地図画像にピンを刺して拾得場所を指定する。
 * 座標は画像サイズに依存しないよう 0..1 に正規化して保存する。
 */
export function MapPicker({
  value,
  onChange,
  readOnly = false,
  mapKeyOverride,
  height = 320,
}: {
  value: Pin | null;
  onChange?: (pin: Pin | null) => void;
  readOnly?: boolean;
  mapKeyOverride?: string;
  height?: number;
}) {
  const [mapKey, setMapKey] = useState<string>(mapKeyOverride ?? "");
  const [loading, setLoading] = useState(!mapKeyOverride);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (mapKeyOverride) {
      setMapKey(mapKeyOverride);
      setLoading(false);
      return;
    }
    api.getMap()
      .then((k) => setMapKey(k))
      .catch(() => setMapKey(""))
      .finally(() => setLoading(false));
  }, [mapKeyOverride]);

  const place = (clientX: number, clientY: number) => {
    if (readOnly || !onChange) return;
    const el = boxRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    const y = Math.min(1, Math.max(0, (clientY - r.top) / r.height));
    onChange({ x, y });
  };

  if (loading) return <div className="rb-banner">地図を読込中…</div>;

  if (!mapKey) {
    return (
      <div className="rb-banner">
        地図が未設定です。「管理 &gt; 設定」から地図画像をアップロードしてください。
      </div>
    );
  }

  return (
    <div>
      <div
        ref={boxRef}
        className="map-box"
        style={{ height }}
        onClick={(e) => place(e.clientX, e.clientY)}
        role={readOnly ? undefined : "button"}
        tabIndex={readOnly ? undefined : 0}
        aria-label={readOnly ? "拾得場所の地図" : "地図をタップして拾得場所を指定"}
        onKeyDown={(e) => {
          if (readOnly || !onChange || !value) return;
          const step = e.shiftKey ? 0.05 : 0.01;
          const moves: Record<string, Pin> = {
            ArrowUp: { x: value.x, y: Math.max(0, value.y - step) },
            ArrowDown: { x: value.x, y: Math.min(1, value.y + step) },
            ArrowLeft: { x: Math.max(0, value.x - step), y: value.y },
            ArrowRight: { x: Math.min(1, value.x + step), y: value.y },
          };
          if (moves[e.key]) {
            e.preventDefault();
            onChange(moves[e.key]);
          }
        }}
      >
        <img src={imageUrl(mapKey)} alt="会場地図" className="map-img" draggable={false} />
        {value && (
          <span
            className="map-pin"
            style={{ left: `${value.x * 100}%`, top: `${value.y * 100}%` }}
            aria-label={`拾得場所ピン (${(value.x * 100).toFixed(0)}%, ${(value.y * 100).toFixed(0)}%)`}
          />
        )}
      </div>
      {!readOnly && (
        <div className="rb-row mt-8">
          <span className="rb-hint">
            {value
              ? `ピン位置: ${(value.x * 100).toFixed(0)}% , ${(value.y * 100).toFixed(0)}%（矢印キーで微調整）`
              : "地図をタップして拾得場所を指定"}
          </span>
          {value && onChange && (
            <Button variant="outline" size="sm" onClick={() => onChange(null)}>
              ピンを消す
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
