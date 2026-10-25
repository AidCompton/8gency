import type { NextConfig } from "next";

const dev = process.env.NODE_ENV !== "production";

// Content security policy: nothing loads from, posts to or is framed by another
// site. 'unsafe-inline' stays for scripts and styles because Next injects inline
// ones; the rest still blocks injected third-party scripts, plugins and framing.
// ponytail: move to a per-request nonce (proxy.ts) to drop 'unsafe-inline' for scripts.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self'${dev ? " ws: wss:" : ""}`,
  "media-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  // Proof PDFs open in a same-origin frame.
  "frame-ancestors 'self'",
  ...(dev ? [] : ["upgrade-insecure-requests"]),
].join("; ");

const common = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  ...(dev ? [] : [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }]),
];

const nextConfig: NextConfig = {
  serverExternalPackages: ["pg", "bcryptjs"],
  poweredByHeader: false,
  // Default bottom-left badge covers the sidebar's log out link.
  devIndicators: { position: "bottom-right" },
  experimental: { serverActions: { bodySizeLimit: "50mb" } },
  async headers() {
    return [
      // The client hub link carries a secret in its address: never pass it on as a referrer.
      { source: "/hub/:path*", headers: [...common, { key: "Referrer-Policy", value: "no-referrer" }] },
      { source: "/reset/:path*", headers: [...common, { key: "Referrer-Policy", value: "no-referrer" }] },
      { source: "/invite/:path*", headers: [...common, { key: "Referrer-Policy", value: "no-referrer" }] },
      { source: "/signup", headers: [...common, { key: "Referrer-Policy", value: "no-referrer" }] },
      { source: "/((?!hub|reset|invite|signup).*)", headers: [...common, { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" }] },
    ];
  },
};

export default nextConfig;
