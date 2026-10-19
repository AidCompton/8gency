import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["pg", "bcryptjs"],
  experimental: { serverActions: { bodySizeLimit: "50mb" } },
};

export default nextConfig;
