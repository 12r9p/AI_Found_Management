import type { ComponentPropsWithoutRef } from "react";
import { imageUrl, type ImageVariant } from "../lib/api";

/**
 * Cloudflare Worker が配信する画像用の薄い共通ラッパー。
 *
 * Next Image Optimizer は経由せず、variant と読み込み属性だけを画面間で統一する。
 * 表示サイズは呼び出し側の CSS に任せるため、固定の width/height は要求しない。
 */
export type FoundImageProps = Omit<ComponentPropsWithoutRef<"img">, "src" | "alt"> & {
  imageKey: string;
  variant: ImageVariant;
  alt: string;
};

export function FoundImage({
  imageKey,
  variant,
  alt,
  loading = variant === "thumb" ? "lazy" : "eager",
  decoding = "async",
  ...props
}: FoundImageProps) {
  return (
    <img
      {...props}
      src={imageUrl(imageKey, variant)}
      alt={alt}
      loading={loading}
      decoding={decoding}
    />
  );
}
