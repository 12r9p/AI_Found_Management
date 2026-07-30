import type { Store } from "../store/index.ts";

/** 拾得場所プリセット。名前と地図上の塗りつぶしエリア（多角形、0..1正規化座標）を対応付ける。 */
export interface LocationPreset {
  name: string;
  points: { x: number; y: number }[];
}

const PRESETS_KEY = "location_presets";
const MAX_POINTS = 50;
const MAX_PRESETS = 100;

export function normalizePresets(input: any): LocationPreset[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: LocationPreset[] = [];
  for (const raw of input) {
    const name = String(raw?.name ?? "").trim().slice(0, 40);
    const rawPoints = Array.isArray(raw?.points) ? raw.points : [];
    const points = rawPoints
      .map((p: any) => ({ x: Number(p?.x), y: Number(p?.y) }))
      .filter((p: any) => Number.isFinite(p.x) && Number.isFinite(p.y))
      .map((p: any) => ({ x: Math.min(1, Math.max(0, p.x)), y: Math.min(1, Math.max(0, p.y)) }))
      .slice(0, MAX_POINTS);
    if (!name || seen.has(name) || points.length < 3) continue;
    seen.add(name);
    out.push({ name, points });
    if (out.length >= MAX_PRESETS) break;
  }
  return out;
}

export async function getLocationPresets(store: Store): Promise<LocationPreset[]> {
  const raw = await store.getSetting(PRESETS_KEY);
  if (!raw) return [];
  try {
    return normalizePresets(JSON.parse(raw));
  } catch {
    return [];
  }
}

export async function setLocationPresets(store: Store, presets: LocationPreset[]): Promise<LocationPreset[]> {
  const p = normalizePresets(presets);
  await store.setSetting(PRESETS_KEY, JSON.stringify(p));
  return p;
}
