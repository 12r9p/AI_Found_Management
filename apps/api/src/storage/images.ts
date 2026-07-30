import type { Config } from "../config.ts";

export interface ImageStorage {
  put(key: string, data: ArrayBuffer, contentType: string): Promise<void>;
  get(key: string): Promise<{ body: ArrayBuffer; contentType: string } | null>;
  delete(key: string): Promise<void>;
}

/** R2（本番）または ローカルディスク（開発）。 */
export function createImageStorage(cfg: Config): ImageStorage {
  if (cfg.r2) return new R2Storage(cfg.r2);
  return new DiskStorage();
}

class R2Storage implements ImageStorage {
  constructor(private bucket: R2Bucket) {}
  async put(key: string, data: ArrayBuffer, contentType: string): Promise<void> {
    await this.bucket.put(key, data, { httpMetadata: { contentType } });
  }
  async get(key: string) {
    const obj = await this.bucket.get(key);
    if (!obj) return null;
    return {
      body: await obj.arrayBuffer(),
      contentType: obj.httpMetadata?.contentType ?? "application/octet-stream",
    };
  }
  async delete(key: string): Promise<void> {
    await this.bucket.delete(key);
  }
}

/** Bun ローカル用。.data/uploads/ 配下に保存。 */
class DiskStorage implements ImageStorage {
  private dir: string;
  constructor() {
    this.dir = this.resolveDir();
  }
  private metaSuffix = ".meta";
  private async ensure() {
    const { mkdir } = await import("node:fs/promises");
    await mkdir(this.dir, { recursive: true });
  }
  /**
   * 保存先は API パッケージ直下に固定する。
   * 相対パスのままだと起動時のカレントディレクトリで保存先が変わり、
   * 起動方法を変えた途端に既存画像が 404 になるため。
   */
  private resolveDir(): string {
    // src/storage/images.ts → apps/api
    const here = new URL("../../", import.meta.url).pathname;
    return `${decodeURIComponent(here).replace(/\/$/, "")}/.data/uploads`;
  }
  private safe(key: string) {
    return key.replace(/[^a-zA-Z0-9._-]/g, "_");
  }
  async put(key: string, data: ArrayBuffer, contentType: string): Promise<void> {
    await this.ensure();
    const { writeFile } = await import("node:fs/promises");
    const p = `${this.dir}/${this.safe(key)}`;
    await writeFile(p, Buffer.from(data));
    await writeFile(`${p}${this.metaSuffix}`, contentType);
  }
  async get(key: string) {
    try {
      const { readFile } = await import("node:fs/promises");
      const p = `${this.dir}/${this.safe(key)}`;
      const buf = await readFile(p);
      let contentType = "application/octet-stream";
      try {
        contentType = (await readFile(`${p}${this.metaSuffix}`, "utf8")).trim();
      } catch {
        /* noop */
      }
      return {
        body: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer,
        contentType,
      };
    } catch {
      return null;
    }
  }
  async delete(key: string): Promise<void> {
    try {
      const { unlink } = await import("node:fs/promises");
      const p = `${this.dir}/${this.safe(key)}`;
      await unlink(p);
      await unlink(`${p}${this.metaSuffix}`).catch(() => {});
    } catch {
      /* noop */
    }
  }
}
