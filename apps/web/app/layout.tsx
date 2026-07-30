import type { Metadata, Viewport } from "next";
import "./globals.css";
import { UIProvider } from "../components/ui";

export const metadata: Metadata = {
  title: "遺失物管理 | RawBlock",
  description: "遺失物（落し物）管理アプリ — AIタグ付け・ベクトル検索・自動照合",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#000000",
};

// 描画前にテーマを適用（ちらつき防止）
const themeScript = `(function(){try{var t=localStorage.getItem('rb-theme');if(t){document.documentElement.setAttribute('data-theme',t);}}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <UIProvider>{children}</UIProvider>
      </body>
    </html>
  );
}
