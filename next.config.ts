import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

const nextConfig: NextConfig = {
  images: {
    unoptimized: true,
  },
  experimental: {
    serverActions: { bodySizeLimit: "2mb" },
  },
};

initOpenNextCloudflareForDev();

export default nextConfig;
