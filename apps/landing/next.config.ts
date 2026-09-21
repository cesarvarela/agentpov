import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @agentview/ui ships TypeScript source, so Next has to compile it.
  transpilePackages: ["@agentview/ui"],
};

export default nextConfig;
