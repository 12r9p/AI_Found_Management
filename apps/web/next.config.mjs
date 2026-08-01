/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // 画像は API(R2/disk) 経由で配信するため Next Image 最適化は使わない
  images: { unoptimized: true },
  typescript: { ignoreBuildErrors: false },
};

export default nextConfig;
