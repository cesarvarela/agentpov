import type { NextConfig } from "next";

// Served by GitHub Pages at cesarvarela.github.io/agentpov, so the Pages
// workflow sets PAGES_BASE_PATH=/agentpov. Unset locally and on a custom domain.
const basePath = process.env.PAGES_BASE_PATH || undefined;

const nextConfig: NextConfig = {
  // Static HTML export: GitHub Pages has no Node server.
  output: "export",
  basePath,
  trailingSlash: true,
  images: { unoptimized: true },
  // @agentpov/ui ships TypeScript source, so Next has to compile it.
  transpilePackages: ["@agentpov/ui"],
};

export default nextConfig;
