import { NextRequest, NextResponse } from "next/server";

const TARGET_API = process.env.NEXT_PUBLIC_API_BASE ?? "https://found.s-t.work";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams.toString();
  const url = `${TARGET_API}/api/items${searchParams ? `?${searchParams}` : ""}`;

  const token = request.headers.get("cf-access-jwt-assertion");
  const headers: Record<string, string> = {
    Accept: "application/json",
  };

  if (token) {
    headers["Cf-Access-Jwt-Assertion"] = token;
    headers["Cookie"] = `CF_Authorization=${token}`;
  }

  try {
    const res = await fetch(url, {
      headers,
      cache: "no-store",
    });

    if (res.redirected && res.url.includes("cloudflareaccess.com")) {
      return NextResponse.json(
        { error: "Cloudflare Access (Zero Trust) の認証が必要です。トークンを設定してください。" },
        { status: 401 },
      );
    }

    if (!res.ok) {
      return NextResponse.json(
        { error: `Remote API error: HTTP ${res.status}` },
        { status: res.status },
      );
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 },
    );
  }
}
