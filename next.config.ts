import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["pg", "bcryptjs"],
  // Default bottom-left badge covers the sidebar's log out link.
  devIndicators: { position: "bottom-right" },
  experimental: { serverActions: { bodySizeLimit: "50mb" } },
};

export default nextConfig;
