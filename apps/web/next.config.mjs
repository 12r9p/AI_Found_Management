import { execFileSync } from "node:child_process";
import withSerwistInit from "@serwist/next";

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

const buildRevision = getBuildRevision();

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // 画像は API(R2/disk) 経由で配信するため Next Image 最適化は使わない
  images: { unoptimized: true },
  typescript: { ignoreBuildErrors: false },
  env: {
    NEXT_PUBLIC_BUILD_REVISION: buildRevision,
  },
};

const withSerwist = withSerwistInit({
  swSrc: "app/sw.ts",
  swDest: "public/sw.js",
  register: false,
  cacheOnNavigation: false,
  reloadOnOnline: false,
  disable: process.env.NODE_ENV !== "production",
  globPublicPatterns: ["icon-*.png"],
});

export default withSerwist(nextConfig);
