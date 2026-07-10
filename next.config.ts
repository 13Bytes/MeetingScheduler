import type { NextConfig } from "next";

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
const convexSiteUrl = process.env.NEXT_PUBLIC_CONVEX_SITE_URL;
const convexWebSocketUrl = convexUrl?.replace(/^http/u, "ws");
const connectSources = ["'self'", convexUrl, convexSiteUrl, convexWebSocketUrl]
  .filter((source): source is string => Boolean(source))
  .join(" ");
const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  `connect-src ${connectSources}`,
  "font-src 'self' data:",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "img-src 'self' data: blob:",
  "object-src 'none'",
  `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
].join("; ");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Content-Security-Policy", value: contentSecurityPolicy },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          ...(process.env.NODE_ENV === "production"
            ? [
                {
                  key: "Strict-Transport-Security",
                  value: "max-age=31536000; includeSubDomains",
                },
              ]
            : []),
        ],
      },
    ];
  },
};

export default nextConfig;
