import type { NextConfig } from "next";

// Served by GitHub Pages at cesarvarela.github.io/agentview, so the Pages
// workflow sets PAGES_BASE_PATH=/agentview. Unset locally and on a custom domain.
const basePath = process.env.PAGES_BASE_PATH || undefined;

const nextConfig: NextConfig = {
  // Static HTML export: GitHub Pages has no Node server.
  output: "export",
  basePath,
  trailingSlash: true,
  images: { unoptimized: true },
  // @agentview/ui ships TypeScript source, so Next has to compile it.
  transpilePackages: ["@agentview/ui"],
};

export default nextConfig;
