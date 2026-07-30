# 遺失物（落し物）管理アプリケーション

現場での拾得物登録から、AI による特徴タグ付け・ベクトル検索・未解決問い合わせとの自動照合までを
ワンストップで扱うスタッフ向けアプリ。UI は **RawBlock**（白黒基調・高コントラスト・ブルータリズム、
light/dark 対応）で、夏の屋外運用でも視認しやすいことを重視しています。

> 認証はアカウント機能を持たず、**Cloudflare Zero Trust (Access)** に委譲する前提です。
> 個人情報はシステムに入力しません（問い合わせは紙台帳＝受付番号で管理）。

---

## アーキテクチャ

```
apps/
  api/   Elysia (Cloudflare Workers / Bun)  … REST API・AI・照合・ストレージ
  web/   Next.js 15 (Cloudflare Workers, OpenNext) … 登録/探す/照合/管理
```

| 層 | 採用 | 備考 |
| --- | --- | --- |
| フロント | **Next.js 15**（App Router） | Workers に OpenNext でデプロイ。API と分離。 |
| API | **Elysia** | Bun ローカル / Workers 両対応（`src/index.ts` と `src/worker.ts`）。 |
| インフラ | **Cloudflare Workers** | フロントと API を別 Worker として分離デプロイ。 |
| DB | **D1 + Vectorize** | D1 が行データ（source of truth）、Vectorize が埋め込みの近似最近傍検索（items/inquiries で2インデックス）。バインディング未設定時（素の `bun run dev:api` 等）は**インメモリ**で起動（外部依存ゼロでデモ可）。ローカルでは `apps/api/.data/store.json` に自動保存され、再起動しても消えない。 |
| ストレージ | **R2** | 遺失物画像。ローカルは `apps/api/.data/uploads/` にフォールバック（保存先はカレントディレクトリに依存しない絶対パス）。 |
| AI | **GPT 5.6 Luna 相当 / effort=low** | 画像特徴抽出＋埋め込み。`AI_API_KEY` 未設定時は**決定論的モック**で動作（日本語は文字 n-gram 埋め込み）。 |

### 設計上のポイント
- **抽象化レイヤ**：ストレージ（`Store`）・AI（`AIProvider`）・画像（`ImageStorage`）は
  インターフェース化。本番設定（D1+Vectorize / 実 AI / R2）と、依存ゼロのローカル実装を透過的に切替。
- **DB をほぼ直接触れる編集権限**：一覧テーブルのセル直接編集（onBlur 自動保存）＋個別ページで
  ほぼ全カラムを編集可能。現場対応力を優先。
- **突き合わせ**：新規登録時にベクトル類似度＋カテゴリ整合ガードで自動照合。該当なしの問い合わせは
  `open` のまま保存し、後日一致する遺失物が登録された時点でスタッフへ通知。
  既知の組み合わせは再通知しない（編集のたびに同じ通知が積み上がるとスタッフが通知を見なくなるため）。
- **UX 上の判断**：
  - 入力・検索条件・タブ位置は `sessionStorage` で保持し、画面を離れて戻っても失われない
    （現場では登録途中に在庫を見に行く動線が頻繁にある）。タブを閉じれば消えるので共有端末に残らない。
  - 拾得場所は会場地図へのピン留めで記録（座標は 0..1 に正規化して保存するため、
    地図を差し替えても相対位置が保たれる）。
  - AI 解析・アップロード・検索の待ち時間はスピナー＋文言で明示。
  - **取り返しのつく操作にする**：返却済みへの変更はトーストの「取り消す」で即座に戻せる。
    登録直後も「登録内容を編集」をトーストに残し、閉じてしまっても直せるようにしている。
  - **窓口と編集を分ける**：探す→結果クリックは受付用の「照会」ポップアップ（返却処理まで完結）。
    編集は一段挟んでから入る（誤操作でデータを触らせない）。
  - 拾得日時は「今 / 10分前 / 30分前 / 1時間前」のボタンで入力（現場の大半はこれで足りる）。

---

## 画面

| パス | 対象 | 内容 |
| --- | --- | --- |
| `/register` | 登録する人（現場・スマホ） | 画像2枚 → AI タグ付け → 地図にピン → 登録。登録後は確認ポップアップ→「続けて登録」。 |
| `/search` | 探す人（受付） | 条件（左）と結果（右）の2カラム。結果クリックで照会ポップアップ→返却/編集。 |
| `/matches` | 照合（受付） | 問い合わせと遺失物の突き合わせ一覧。確認・確定はポップアップで行う。 |
| `/admin` | システム管理 | 物品一覧（画像付き編集テーブル）/ 問い合わせ / 設定（管理番号・会場地図・種別・色）の3タブ。PDF/CSV 出力。 |
| `/items/[id]` | — | 物品の個別編集ページ（DB 直接編集＋地図ピン修正）。 |
| `/print` | — | PDF 出力用の印刷ビュー（ブラウザの「PDF で保存」）。 |

ヘッダーは「通知ベル」と「ハンバーガーメニュー（ライト/ダーク切替・画面移動・設定）」のみ。
常時表示の要素を減らし、現場で迷わない構成にしています。

### 画面遷移の考え方（ポップアップ中心）
一覧から詳細へ「画面遷移」すると、戻ったときに検索条件やスクロール位置、
編集途中の内容を失いがちです。そのため本アプリでは **確認系はすべてポップアップ** で重ねます。

- ダイアログ見出しには `照合 › [突き合わせの確認]` のように **呼び出し元** を表示し、階層を明示。
- 背面はブラー＋暗幕でスクロールを止め、前後関係を視覚的に固定。
- 二段階（例: 問い合わせ › 候補 › 突き合わせの確認）も重ねて表示。
- 実際にページ遷移するのは「編集ページを開く」など、作業を切り替える時だけ。
- 通知もポップアップ。ベルで画面遷移しないため履歴が汚れず、作業中の画面を失いません。

---

## ローカル起動（外部サービス不要）

```bash
bun install            # ルートで（workspaces）
bun run dev            # API(:8787) と Web(:3000) を同時起動
```

別ターミナルでデモデータ投入（API 起動後）:

```bash
bun run seed
```

- Web: http://localhost:3000
- API health: http://localhost:8787/api/health → `store: memory, ai: mock`

> 素の `bun run dev:api`（Bun ランタイム）は D1/Vectorize バインディングに到達できず常にインメモリで動きます。
> D1+Vectorize を実際に使う動作確認は `wrangler dev`（Miniflare のローカルバインディング）または
> デプロイ後の環境で行ってください（下記デプロイ手順参照）。

テスト:

```bash
bun test               # ベクトル・照合ロジックのユニットテスト
```

---

## 本番設定（環境変数）

`.env.example` を参照。主要なもの:

| 変数 | 用途 |
| --- | --- |
| `AI_API_KEY` / `AI_BASE_URL` | AI プロバイダ（OpenAI 互換）。未設定＝モック。 |
| `AI_VISION_MODEL` | 既定 `gpt-5.6-luna`。 |
| `AI_EMBED_MODEL` / `EMBED_DIM` | 埋め込みモデルと次元（既定 1536）。 |
| `AI_EFFORT` | 既定 `low`（予算内運用）。 |
| `MATCH_THRESHOLD` | 照合のコサイン類似度しきい値（既定 `0.5`）。 |
| `WEB_ORIGIN` | CORS 許可オリジン。 |
| `ACCESS_TEAM_DOMAIN` / `ACCESS_AUD` | 両方設定すると API が Cloudflare Access の JWT を検証（下記デプロイ手順参照）。未設定＝検証なし。 |

### DB 準備（D1 + Vectorize）
D1 のスキーマは `wrangler d1 migrations` で適用します（`apps/api/migrations/0001_init.sql`）。
Vectorize インデックス（`found-items`/`found-inquiries`）は別途作成が必要です。手順は
下記デプロイ手順を参照。`bun run migrate` は適用済みかどうかの案内を表示するだけです。

---

## デプロイ（Cloudflare）

> このリポジトリの手元の認証情報は別アカウントのものです。デプロイ時は対象アカウントへ
> `wrangler login` し直してください（`AI_API_KEY` は `wrangler secret put`）。

### 1. API Worker

```bash
cd apps/api
wrangler r2 bucket create found-images                                   # R2 バケット
wrangler d1 create found-db                                              # D1（database_id を wrangler.toml に反映）
wrangler vectorize create found-items --dimensions=1536 --metric=cosine       # Vectorize（物品）
wrangler vectorize create found-inquiries --dimensions=1536 --metric=cosine   # Vectorize（問い合わせ）
wrangler d1 migrations apply found-db --remote                           # スキーマ適用
wrangler secret put AI_API_KEY                                           # AI プロバイダ
wrangler deploy                                                          # src/worker.ts
```

`wrangler.toml` で R2（`IMAGES`）・D1（`DB`）・Vectorize（`VECTORIZE_ITEMS`/`VECTORIZE_INQUIRIES`）
バインディングを定義済み。

### 2. Web Worker（OpenNext）

```bash
cd apps/web
# NEXT_PUBLIC_API_BASE を API Worker の URL に設定（wrangler.toml [vars]）
bun run cf:deploy                               # opennextjs build + wrangler deploy
```

### 3. 認証（Cloudflare Zero Trust / Access）— **API も保護対象**
アプリ側にログイン機構は持ちません。**Web と API の両方**を Access アプリケーションで保護します。
API を保護しないとフロントだけ守っても意味がない（API を直接叩けばデータを読み書きできてしまう）ため、
必ず 2 つとも登録してください。

1. Zero Trust ダッシュボード → Access → Applications → **Self-hosted** を作成。
2. **Web 用と API 用の 2 つ**を作成し、それぞれのカスタムドメインを登録。
3. ポリシーで許可するスタッフ（Emails / Groups / IdP）を指定。
4. API アプリの **Application Audience (AUD) タグ** を控える。

#### 多層防御: API 側でも JWT を検証する（推奨）
Access はアプリ手前で認証し、`Cf-Access-Jwt-Assertion` ヘッダに署名付き JWT を付けて転送します。
`*.workers.dev` の既定 URL など、Access を経由しない経路が残っていると素通しになりうるため、
API 側でもこの JWT を検証します（`src/lib/access.ts`、JWKS/RS256・iss/aud/exp 検証）。

```bash
cd apps/api
wrangler secret put ACCESS_TEAM_DOMAIN   # 例: your-team.cloudflareaccess.com
wrangler secret put ACCESS_AUD           # API アプリの AUD タグ
```

- 両方を設定した時のみ検証が有効になります（未設定のローカル開発では素通し）。
- 検証が有効かは `GET /api/health` の `accessProtected` で確認できます。
- 併せて、Workers の既定ドメイン（`workers.dev`）を無効化し、カスタムドメイン経由のみ受け付ける
  設定を推奨します。

API の CORS は資格情報付きリクエストを許可済み（同一 Access 配下のフロントから利用）。

---

## 機能要件（MVP）との対応

| 要件 | 実装 |
| --- | --- |
| 遺失物画像のアップロード（2枚程度） | `/api/uploads`（最大2枚, R2/disk）、登録画面のカメラ対応 |
| AI による画像特徴のタグ付け（文章化） | `/api/analyze`（Vision → 特徴文＋タグ、個人情報を書かない指示） |
| タグのベクトル検索 | 埋め込み＋Vectorize（近似最近傍）/ メモリ時は JS コサイン。`/api/search` |
| フィルターによる絞り込み | 種別・色・状態・拾得場所・日付範囲（種別・色は設定で編集可） |
| 未解決問い合わせとの突き合わせ | 登録時自動照合＋カテゴリガード。該当なしは保存し後日照合＋通知 |
| リスト表示・DB 直接編集 | 編集可能テーブル（自動保存）＋個別ページ |
| PDF 出力 | `/print` 印刷ビュー（＋ CSV 出力） |
| 画面区分（登録/探す/管理） | `/register`・`/search`・`/admin`（＋受付作業用に `/matches` を独立） |
| 白黒・light/dark・高コントラスト | RawBlock（`app/globals.css`）、テーマ切替はハンバーガーメニュー内・永続化 |
| 編集テーブル＋個別ページ | 実装済み（`ItemsTable`・`items/[id]`） |
| 管理番号（ID）の命名規則 | 管理＞設定で接頭辞・日付形式・桁数・リセット周期を編集（`/api/id-rule`）。登録時に自動採番 |
| 一覧・PDF に画像を表示 | 管理テーブルにサムネイル列、`/print` にも写真を掲載（画像読込後に印刷） |
| 拾得場所を地図ピンで運用 | 管理＞設定で会場地図をアップロード。登録/詳細でピン留め（`MapPicker`） |
| 問い合わせの一覧・照合候補の確認 | 管理＞問い合わせ（候補を画像付きで表示 → クリックで突き合わせ確認） |
| 種別・色の編集 | 管理＞設定（`PUT /api/meta/:kind`、設定テーブルに保存） |
| 個人情報を入れない | 受付番号のみ・注意書き・AI へも個人情報を出さない設計 |
| 認証: アカウントなし + Zero Trust | ログイン機構なし。Web/API 双方を Access で保護＋API 側で JWT 検証（上記） |

デザインの正は [`design.md`](design.md)（＝ `app/globals.css`）。
