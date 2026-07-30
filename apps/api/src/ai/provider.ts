import type { Config } from "../config.ts";

export interface ImageInput {
  /** data URL もしくは公開 URL。base64 は "data:image/...;base64,...."。 */
  url: string;
}

export interface DescribeResult {
  /** 検索・照合に使う特徴文（日本語）。 */
  description: string;
  /** 正規化タグ（色・種別・素材・ブランド・特徴など）。 */
  tags: string[];
  /** 推定カテゴリ・色（フォーム初期値の補助）。 */
  category: string;
  color: string;
  brand: string;
}

export interface AIProvider {
  readonly name: string;
  /** 画像（1〜2枚）＋任意メモから特徴文とタグを生成。 */
  describeImages(images: ImageInput[], hint?: string): Promise<DescribeResult>;
  /** テキストを埋め込みベクトルへ。 */
  embed(text: string): Promise<number[]>;
  /** スタッフ補助チャット（RAG 済みコンテキストを与えて回答）。 */
  chat(
    messages: { role: "system" | "user" | "assistant"; content: string }[],
  ): Promise<string>;
}

export function createAIProvider(cfg: Config): AIProvider {
  if (cfg.ai.apiKey) return new OpenAICompatProvider(cfg);
  return new MockProvider(cfg);
}

// ---------------------------------------------------------------------------
// OpenAI 互換プロバイダ（GPT 5.6 Luna 相当, effort=low）
// ---------------------------------------------------------------------------
class OpenAICompatProvider implements AIProvider {
  readonly name = "openai-compat";
  constructor(private cfg: Config) {}

  private async post(path: string, body: unknown): Promise<any> {
    const res = await fetch(`${this.cfg.ai.baseUrl}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.cfg.ai.apiKey}`,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`AI request failed ${res.status}: ${t.slice(0, 300)}`);
    }
    return res.json();
  }

  async describeImages(images: ImageInput[], hint?: string): Promise<DescribeResult> {
    const sys =
      "あなたは遺失物管理システムの特徴抽出器です。画像から遺失物の客観的特徴のみを抽出します。" +
      "人物・顔・氏名・連絡先など個人を特定しうる情報は一切記述しないこと。" +
      "出力は必ず次のJSON: {\"description\":string,\"tags\":string[],\"category\":string,\"color\":string,\"brand\":string}。" +
      "description は検索照合用の日本語の特徴文（80〜160字）。tags は色・種別・素材・形状・特徴を短い日本語語で。";
    const content: any[] = [
      { type: "text", text: hint ? `補足メモ: ${hint}` : "画像から特徴を抽出してください。" },
      ...images.map((im) => ({ type: "image_url", image_url: { url: im.url } })),
    ];
    const data = await this.post("/chat/completions", {
      model: this.cfg.ai.visionModel,
      reasoning_effort: this.cfg.ai.effort,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: sys },
        { role: "user", content },
      ],
    });
    const raw = data.choices?.[0]?.message?.content ?? "{}";
    return normalizeDescribe(safeParse(raw));
  }

  async embed(text: string): Promise<number[]> {
    const data = await this.post("/embeddings", {
      model: this.cfg.ai.embedModel,
      input: text || " ",
    });
    return data.data?.[0]?.embedding ?? [];
  }

  async chat(messages: { role: "system" | "user" | "assistant"; content: string }[]): Promise<string> {
    const data = await this.post("/chat/completions", {
      model: this.cfg.ai.visionModel,
      reasoning_effort: this.cfg.ai.effort,
      messages,
    });
    return data.choices?.[0]?.message?.content ?? "";
  }
}

// ---------------------------------------------------------------------------
// モックプロバイダ（外部依存ゼロ。決定論的埋め込み＋テンプレ特徴文）
// ---------------------------------------------------------------------------
class MockProvider implements AIProvider {
  readonly name = "mock";
  constructor(private cfg: Config) {}

  async describeImages(images: ImageInput[], hint?: string): Promise<DescribeResult> {
    // 画像バイト列とヒントからそれっぽいタグを疑似生成（デモ用）。
    const seed = (hint ?? "") + images.map((i) => i.url.slice(-64)).join("");
    const palette = ["黒", "白", "紺", "赤", "茶", "灰", "青", "緑"];
    const kinds = ["財布", "傘", "スマートフォン", "鍵", "水筒", "眼鏡", "帽子", "イヤホン"];
    const materials = ["革", "布", "金属", "プラスチック", "ナイロン"];
    const h = hash(seed);
    // `>>` は符号付きシフトのため h>=2^31 だと負数化し、配列アクセスが undefined になる。
    // 添字計算は必ず `>>>`（符号なしシフト）を使う。
    const color = palette[h % palette.length];
    const category = kinds[(h >>> 3) % kinds.length];
    const material = materials[(h >>> 6) % materials.length];
    const tags = [color, category, material, "特徴あり"];
    if (hint) tags.push(...hint.split(/[\s,、]+/).filter(Boolean).slice(0, 3));
    const description =
      `${color}色の${category}。素材は${material}とみられる。` +
      `${hint ? `補足: ${hint}。` : ""}目立った装飾や汚れの有無を確認のこと。`;
    return normalizeDescribe({ description, tags, category, color, brand: "" });
  }

  async embed(text: string): Promise<number[]> {
    return deterministicEmbed(text, this.cfg.ai.embedDim);
  }

  async chat(messages: { role: string; content: string }[]): Promise<string> {
    const last = [...messages].reverse().find((m) => m.role === "user");
    return (
      "【デモ応答】AIキー未設定のためモック回答です。\n" +
      `お問い合わせ「${(last?.content ?? "").slice(0, 60)}」について、` +
      "画面右の検索やフィルターで該当物品をご確認ください。実運用では GPT 5.6 Luna が回答します。"
    );
  }
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * 決定論的な擬似埋め込み。同じ文字列 → 同じベクトル。
 * 日本語は分かち書きされないため、文字 n-gram（1〜3）を主特徴にして
 * スペース無しの文でも類似度が出るようにする（実モデルの代替）。
 */
export function deterministicEmbed(text: string, dim: number): number[] {
  const v = new Array(dim).fill(0);
  const bump = (feat: string, w: number) => {
    const idx = hash(feat) % dim;
    v[idx] += w;
    v[(idx + 1) % dim] += w * 0.4; // 近傍拡散でハッシュ衝突の悪影響を緩和
  };
  // 単語トークン（英数・タグはスペース区切りで効く）
  const tokens = (text || " ")
    .toLowerCase()
    .split(/[\s,、。・/()\[\]「」]+/)
    .filter(Boolean);
  for (const tok of tokens) bump(`w:${tok}`, 1.0);

  // 文字 n-gram（日本語の主特徴）。記号・空白を除いた連続文字列に対して。
  const chars = (text || "").toLowerCase().replace(/[\s,、。・/()\[\]「」]+/g, "");
  for (let i = 0; i < chars.length; i++) {
    bump(`u:${chars[i]}`, 0.6); // unigram
    if (i + 2 <= chars.length) bump(`b:${chars.slice(i, i + 2)}`, 1.0); // bigram
    if (i + 3 <= chars.length) bump(`t:${chars.slice(i, i + 3)}`, 1.2); // trigram
  }

  // L2 正規化
  let norm = 0;
  for (const x of v) norm += x * x;
  norm = Math.sqrt(norm) || 1;
  return v.map((x) => x / norm);
}

function safeParse(s: string): any {
  try {
    return JSON.parse(s);
  } catch {
    const m = s.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        return JSON.parse(m[0]);
      } catch {
        /* noop */
      }
    }
    return {};
  }
}

function normalizeDescribe(o: any): DescribeResult {
  const tags = Array.isArray(o.tags)
    ? o.tags.map((t: any) => String(t).trim()).filter(Boolean).slice(0, 12)
    : [];
  return {
    description: String(o.description ?? "").trim(),
    tags: Array.from(new Set(tags)),
    category: String(o.category ?? "").trim(),
    color: String(o.color ?? "").trim(),
    brand: String(o.brand ?? "").trim(),
  };
}
