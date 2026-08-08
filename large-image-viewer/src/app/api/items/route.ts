import { NextRequest, NextResponse } from "next/server";

const TARGET_API = process.env.NEXT_PUBLIC_API_BASE ?? "https://found.s-t.work";

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams.toString();
    const url = `${TARGET_API}/api/items${searchParams ? `?${searchParams}` : ""}`;

    const headers: Record<string, string> = {
      Accept: "application/json",
      "User-Agent": request.headers.get("user-agent") || "NextJS-Proxy",
    };

    // クライアントからの認証ヘッダーおよびCookieをそのままターゲットAPIへ転送
    const jwtHeader = request.headers.get("cf-access-jwt-assertion");
    const cookieHeader = request.headers.get("cookie");
    const authHeader = request.headers.get("authorization");

    if (jwtHeader) {
      headers["Cf-Access-Jwt-Assertion"] = jwtHeader.trim();
      headers["Cookie"] = `CF_Authorization=${jwtHeader.trim()}`;
    } else if (cookieHeader) {
      headers["Cookie"] = cookieHeader;
    }

    if (authHeader) {
      headers["Authorization"] = authHeader;
    }

    const res = await fetch(url, {
      headers,
      cache: "no-store",
      redirect: "manual",
    });

    if (res.status === 302 || res.status === 301 || res.status === 307 || res.type === "opaqueredirect") {
      return NextResponse.json(
        { error: "Cloudflare Access (Zero Trust) の認証が必要です。画面下の入力欄に CF_Authorization トークンを設定してください。" },
        { status: 401 }
      );
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return NextResponse.json(
        { error: `リモートAPIエラー (HTTP ${res.status}): ${text.slice(0, 200)}` },
        { status: res.status }
      );
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("[Route Handler /api/items error]:", error);
    return NextResponse.json(
      { error: `サーバープロキシ例外: ${(error as Error).message}` },
      { status: 500 }
    );
  }
}
