const MAX_DIMENSION = 1600;
const JPEG_QUALITY = 0.85;

/**
 * アップロード前に画像をブラウザで確実に扱える形式（JPEG）へ正規化し、長辺を縮小する。
 * スマホカメラの大容量ファイルや端末依存のHEIC出力による、送信タイムアウトや
 * 他端末での表示崩れを避けるため。EXIFの向きは createImageBitmap 側で補正させる。
 * デコードできない形式（対応していないブラウザ等）では変換をあきらめ、元のファイルを返す。
 */
export async function normalizeImageFile(file: File): Promise<File> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close?.();
    const blob: Blob | null = await new Promise((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY),
    );
    if (!blob) return file;
    const name = file.name.replace(/\.[^.]+$/, "") + ".jpg";
    return new File([blob], name, { type: "image/jpeg" });
  } catch {
    return file;
  }
}

export function normalizeImageFiles(files: File[]): Promise<File[]> {
  return Promise.all(files.map(normalizeImageFile));
}
