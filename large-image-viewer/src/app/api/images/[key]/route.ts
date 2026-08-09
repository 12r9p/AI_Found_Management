import { NextRequest, NextResponse } from "next/server";

const TARGET_API = process.env.NEXT_PUBLIC_API_BASE ?? "https://found.s-t.work";

export async function GET(request: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  try {
    const { key } = await params;
    const variant = request.nextUrl.searchParams.get("variant") || "original";
    const url = `${TARGET_API}/api/images/${encodeURIComponent(key)}?variant=${variant}`;

    const headers: Record<string, string> = {
      "User-Agent": request.headers.get("user-agent") || "NextJS-Proxy",
    };

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

    if (
      res.status === 302 ||
      res.status === 301 ||
      res.status === 307 ||
      res.type === "opaqueredirect"
    ) {
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
