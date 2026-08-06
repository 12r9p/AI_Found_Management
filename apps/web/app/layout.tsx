import type { Metadata, Viewport } from "next";
import { ThemeProvider } from "next-themes";
import "./globals.css";
import { PwaRegistration } from "../components/PwaRegistration";
import { UIProvider } from "../components/ui";

export const metadata: Metadata = {
  title: "遺失物管理",
  description: "遺失物（落し物）管理アプリ — AIタグ付け・ベクトル検索・自動照合",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#000000",
};

// history.pushState/replaceState を差し替える外部スクリプト（Cloudflare の RUM ビーコン等）から
// アプリを守る。ビーコンは本物を呼ぶ前に計測用XHRを同期的に投げるが、iOS Safari の
// コンテンツブロッカーはこれを同期例外にする。Next.js の App Router は pushState/replaceState を
// useInsertionEffect の中で呼ぶため、例外がそのまま React のコミットフェーズへ伝播し、
// ルートごとアンマウントされる = CSSが外れ全ボタンが無反応、という壊れ方をする。
// 差し替え自体は許したうえで、失敗したらネイティブ実装へフォールバックさせる。
// 取得時点の実装をスナップショットするのが要点。差し替える側は決まって
// 「var e = history.pushState」で元実装を控えてから自分の関数を代入するので、
// 呼び出し時に current を見にいくと e が最新の差し替え版を指してしまい無限再帰する。
// head で先に実行しておく必要があるため、インラインスクリプトで入れている。
const historyGuardScript = `(function(){try{var p=History.prototype;["pushState","replaceState"].forEach(function(k){var native=p[k];if(typeof native!=="function")return;var current=native,cached=null,cachedFor=null;Object.defineProperty(p,k,{configurable:true,get:function(){if(cachedFor!==current){cachedFor=current;var impl=current;cached=function(){var href=location.href;try{return impl.apply(this,arguments);}catch(e){if(location.href!==href)throw e;return native.apply(this,arguments);}};}return cached;},set:function(fn){current=typeof fn==="function"?fn:native;}});});}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: historyGuardScript }} />
      </head>
      <body>
        <PwaRegistration />
        <ThemeProvider
          attribute="data-theme"
          storageKey="rb-theme"
          defaultTheme="system"
          enableSystem
          enableColorScheme={false}
        >
          <div className="root">
            <UIProvider>{children}</UIProvider>
          </div>
        </ThemeProvider>
      </body>
    </html>
  );
}
