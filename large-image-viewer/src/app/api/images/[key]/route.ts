import { NextRequest, NextResponse } from "next/server";

const TARGET_API = process.env.NEXT_PUBLIC_API_BASE ?? "https://found.s-t.work";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  try {
    const { key } = await params;
    const variant = request.nextUrl.searchParams.get("variant") || "original";
    const url = `${TARGET_API}/api/images/${encodeURIComponent(key)}?variant=${variant}`;

    const token = request.headers.get("cf-access-jwt-assertion");
    const headers: Record<string, string> = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) NextJS-Proxy",
    };

    if (token && token.trim()) {
      headers["Cf-Access-Jwt-Assertion"] = token.trim();
      headers["Cookie"] = `CF_Authorization=${token.trim()}`;
    }

    const res = await fetch(url, {
      headers,
      cache: "no-store",
      redirect: "manual",
    });

    if (res.status === 302 || res.status === 301 || res.status === 307 || res.type === "opaqueredirect") {
      return new NextResponse("Cloudflare Access Unauthorized", { status: 401 });
    }

    if (!res.ok) {
      return new NextResponse(`Image Proxy Error: HTTP ${res.status}`, { status: res.status });
    }

    const contentType = res.headers.get("content-type") || "image/jpeg";
    const imageBuffer = await res.arrayBuffer();

    return new NextResponse(imageBuffer, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch (error) {
    console.error("[Route Handler /api/images error]:", error);
    return new NextResponse((error as Error).message, { status: 500 });
  }
}
