"use client";
import { Button as BaseButton } from "@base-ui/react/button";
import { useEffect, useId, useRef, useState } from "react";
import { api } from "../lib/api";
import { Button } from "./ui";
import { FoundImage } from "./FoundImage";

export interface Pin {
  x: number; // 0..1
  y: number; // 0..1
}

/** 名前付きの塗りつぶしエリア（多角形）。拾得場所プリセットの実体。 */
export interface MapRegion {
  name: string;
  points: Pin[];
}

// 会場地図はほぼ変わらないため、タブを開いている間はキーを使い回す。
// 画面遷移のたびに毎回「読込中」が出て、地図を読み直しているように見えるのを防ぐ。
let cachedMapKey: string | null = null;
let cachedMapKeyPromise: Promise<string> | null = null;

/** 設定画面で地図を差し替えた直後に呼び、次のマウントで新しい地図を取り直させる。 */
export function invalidateMapCache() {
  cachedMapKey = null;
  cachedMapKeyPromise = null;
}

/** タップ位置がどのエリアに含まれるか判定する（レイキャスト法）。重なりは先勝ち。 */
export function findRegionAt<T extends MapRegion>(regions: T[], pt: Pin): T | null {
  for (const region of regions) {
    const poly = region.points;
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i].x,
        yi = poly[i].y;
      const xj = poly[j].x,
        yj = poly[j].y;
      const intersect =
        yi > pt.y !== yj > pt.y && pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi) + xi;
      if (intersect) inside = !inside;
    }
    if (inside) return region;
  }
  return null;
}

function centroid(points: Pin[]): Pin {
  const n = points.length || 1;
  const s = points.reduce((a, p) => ({ x: a.x + p.x, y: a.y + p.y }), { x: 0, y: 0 });
  return { x: s.x / n, y: s.y / n };
}

function toSvgPoints(points: Pin[]): string {
  return points.map((p) => `${(p.x * 100).toFixed(2)},${(p.y * 100).toFixed(2)}`).join(" ");
}

/**
 * 地図にピンを刺して拾得場所を指定する。
 * `regions` を渡すと塗りつぶしエリア（拾得場所プリセット）を名前付きで重ねて表示できる
 * （実際にどのエリアをタップしたかの判定は呼び出し側で `findRegionAt` を使う）。
 * `previewPoints` は設定画面でエリアを描いている最中の未確定な多角形を表示するためのもの。
 * 座標は画像サイズに依存しないよう 0..1 に正規化して保存する。
 */
export function MapPicker({
  value,
  onChange,
  readOnly = false,
  mapKeyOverride,
  regions,
  activeRegionName,
  previewPoints,
}: {
  value: Pin | null;
  onChange?: (pin: Pin | null) => void;
  readOnly?: boolean;
  mapKeyOverride?: string;
  /** 塗りつぶし表示するエリア一覧（拾得場所プリセット）。 */
  regions?: MapRegion[];
  /** regions のうち、この名前のエリアだけ強調表示する（編集中など）。 */
  activeRegionName?: string;
  /** 描画中（未確定）の多角形の頂点。設定画面のエリア作成ツール用。 */
  previewPoints?: Pin[];
}) {
  const [mapKey, setMapKey] = useState<string>(mapKeyOverride ?? cachedMapKey ?? "");
  const [loading, setLoading] = useState(!mapKeyOverride && cachedMapKey == null);
  const boxRef = useRef<HTMLButtonElement>(null);
  const hintId = useId();

  useEffect(() => {
    if (mapKeyOverride) {
      setMapKey(mapKeyOverride);
      setLoading(false);
      return;
    }
    if (cachedMapKey != null) {
      setMapKey(cachedMapKey);
      setLoading(false);
      return;
    }
    if (!cachedMapKeyPromise) {
      // 失敗時はキャッシュに残さない（次のマウントで再取得できるようにする）。
      // ここで空文字をキャッシュしてしまうと、一時的な通信エラーが
      // 「地図なし」として固定されてしまい、タブを閉じるまで直らなくなる。
      cachedMapKeyPromise = api.getMap().then((k) => {
        cachedMapKey = k;
        return k;
      });
    }
    cachedMapKeyPromise
      .then((k) => {
        setMapKey(k);
        setLoading(false);
      })
      .catch(() => {
        cachedMapKeyPromise = null;
        setMapKey("");
        setLoading(false);
      });
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

  const mapLayers = (
    <>
      <FoundImage
        imageKey={mapKey}
        variant="original"
        alt="会場地図"
        fetchPriority="high"
        className="map-img"
        draggable={false}
      />

      {/* 塗りつぶし自体は元の座標系に忠実に描ければよいので SVG のまま（none で歪んでも
          図形としては正しい）。ただしテキスト・頂点の丸は歪むと文字が横伸びして見えるため、
          .map-pin と同じ「%指定のHTML要素」に out して実ピクセルで描く。 */}
      {((regions && regions.length > 0) || (previewPoints && previewPoints.length > 0)) && (
        <svg className="map-regions" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
          {regions?.map((r) => (
            <polygon
              key={r.name}
              points={toSvgPoints(r.points)}
              className={
                r.name === activeRegionName ? "map-region map-region--active" : "map-region"
              }
            />
          ))}
          {previewPoints && previewPoints.length > 0 && (
            <polygon points={toSvgPoints(previewPoints)} className="map-region-preview" />
          )}
        </svg>
      )}

      {regions?.map((r) => {
        const c = centroid(r.points);
        return (
          <span
            key={`${r.name}-label`}
            className="map-region-label"
            style={{ left: `${c.x * 100}%`, top: `${c.y * 100}%` }}
            aria-hidden
          >
            {r.name}
          </span>
        );
      })}
      {previewPoints?.map((p, i) => (
        <span
          key={i}
          className="map-region-vertex"
          style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }}
          aria-hidden
        />
      ))}

      {value && (
        <span
          className="map-pin"
          style={{ left: `${value.x * 100}%`, top: `${value.y * 100}%` }}
          aria-label={`拾得場所ピン (${(value.x * 100).toFixed(0)}%, ${(value.y * 100).toFixed(0)}%)`}
        />
      )}
    </>
  );

  return (
    <div>
      {readOnly || !onChange ? (
        <div className="map-box">{mapLayers}</div>
      ) : (
        <BaseButton
          ref={boxRef}
          className="map-box"
          aria-label="地図をタップして拾得場所を指定。キーボードではEnterまたはSpaceで中央を選び、矢印キーで調整"
          aria-describedby={hintId}
          onClick={(e) => {
            if (e.detail === 0) {
              if (!value) onChange({ x: 0.5, y: 0.5 });
              return;
            }
            place(e.clientX, e.clientY);
          }}
          onKeyDown={(e) => {
            if (!value) return;
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
          {mapLayers}
        </BaseButton>
      )}
      {!readOnly && (
        <div className="rb-row mt-8">
          <output id={hintId} className="rb-hint" aria-live="polite">
            {value
              ? `ピン位置: ${(value.x * 100).toFixed(0)}% , ${(value.y * 100).toFixed(0)}%（矢印キーで微調整）`
              : ""}
          </output>
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
