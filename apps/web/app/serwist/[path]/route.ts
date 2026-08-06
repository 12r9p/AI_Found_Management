import { execFileSync } from "node:child_process";
import { createSerwistRoute } from "@serwist/turbopack";

const getBuildRevision = () => {
  const providedRevision =
    process.env.GIT_COMMIT_SHA ?? process.env.GITHUB_SHA ?? process.env.CF_PAGES_COMMIT_SHA;
  if (providedRevision?.trim()) return providedRevision.trim();

  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return "development";
  }
};

const route = createSerwistRoute({
  swSrc: "app/sw.ts",
  useNativeEsbuild: true,
  globIgnores: ["public/_headers"],
  esbuildOptions: {
    define: {
      "process.env.NEXT_PUBLIC_BUILD_REVISION": JSON.stringify(getBuildRevision()),
    },
  },
});

export const { dynamic, dynamicParams, revalidate, generateStaticParams } = route;

export const GET = async (request: Request, context: { params: Promise<{ path: string }> }) => {
  const response = await route.GET(request, context);
  response.headers.set("Cache-Control", "no-cache, no-store, must-revalidate");
  return response;
};
