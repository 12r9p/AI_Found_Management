export const IMAGE_CACHE_TTL_SECONDS = 604_800;

export type ImageVariant = "thumb" | "preview" | "original";

type TransformVariant = {
  width: number;
  height?: number;
  fit: "cover" | "scale-down";
  quality: number;
};

export const IMAGE_VARIANTS: Record<Exclude<ImageVariant, "original">, TransformVariant> = {
  thumb: { width: 256, height: 256, fit: "cover", quality: 78 },
  preview: { width: 960, height: 960, fit: "scale-down", quality: 84 },
};
