import { NextRequest, NextResponse } from "next/server";

const TARGET_API = process.env.NEXT_PUBLIC_API_BASE ?? "https://found.s-t.work";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  const { key } = await params;
  const variant = request.nextUrl.searchParams.get("variant") || "original";
  const url = `${TARGET_API}/api/images/${encodeURIComponent(key)}?variant=${variant}`;

  const token = request.headers.get("cf-access-jwt-assertion");
  const headers: Record<string, string> = {};

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
      return new NextResponse("Unauthorized by Cloudflare Access", { status: 401 });
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
    return new NextResponse((error as Error).message, { status: 500 });
  }
}
