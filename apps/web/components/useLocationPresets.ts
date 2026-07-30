"use client";
import { useEffect, useState } from "react";
import { api } from "../lib/api";
import type { LocationPreset } from "../lib/types";

export function useLocationPresets(): LocationPreset[] {
  const [presets, setPresets] = useState<LocationPreset[]>([]);
  useEffect(() => {
    api.getLocationPresets().then(setPresets).catch(() => {});
  }, []);
  return presets;
}
