export function extFromContentType(ct: string): string {
  const map: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "image/heic": "heic",
    "image/avif": "avif",
    "image/svg+xml": "svg", // 会場地図はベクタ画像で入稿されることが多い
    "application/pdf": "pdf",
  };
  return map[ct.toLowerCase()] ?? "bin";
}

/** ArrayBuffer → data URL（AI へ画像を渡すため）。Workers/Bun 両対応。 */
export function arrayBufferToDataUrl(buf: ArrayBuffer, contentType: string): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  const b64 = typeof btoa !== "undefined" ? btoa(binary) : Buffer.from(bytes).toString("base64");
  return `data:${contentType};base64,${b64}`;
}
