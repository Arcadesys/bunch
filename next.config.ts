import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Vercel's Next 16.3 adapter currently conflicts with standalone tracing.
  // Vercel does not consume standalone output; keep it for local/self-host use.
  output: process.env.VERCEL ? undefined : "standalone",
  serverExternalPackages: ["@modelcontextprotocol/sdk"],
  turbopack: { root: process.cwd() },
};

export default nextConfig;
