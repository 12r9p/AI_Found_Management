import type { Store } from "../store/index.ts";

/** 拾得場所プリセット。名前と地図上のピン位置(0..1)を対応付ける。 */
export interface LocationPreset {
  name: string;
  x: number;
  y: number;
}

const PRESETS_KEY = "location_presets";

export function normalizePresets(input: any): LocationPreset[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: LocationPreset[] = [];
  for (const raw of input) {
    const name = String(raw?.name ?? "").trim().slice(0, 40);
    const x = Number(raw?.x);
    const y = Number(raw?.y);
    if (!name || seen.has(name) || !Number.isFinite(x) || !Number.isFinite(y)) continue;
    seen.add(name);
    out.push({ name, x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) });
    if (out.length >= 100) break;
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
