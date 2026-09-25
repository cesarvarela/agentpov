import { resolve } from "node:path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  main: {
    // externalizeDepsPlugin only externalizes package.json `dependencies`.
    // The desktop package keeps every library in devDependencies so all of it
    // is bundled into out/ and the packaged app ships without node_modules
    // (see electron-builder.yml). @agentpov/core is excluded explicitly as
    // well: it is pure ESM and must not be require()d from the CJS main bundle.
    plugins: [externalizeDepsPlugin({ exclude: ["@agentpov/core"] })],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, "src/main/index.ts") },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, "src/preload/index.ts") },
      },
    },
  },
  renderer: {
    root: resolve(__dirname, "src/renderer"),
    resolve: {
      alias: {
        "@renderer": resolve(__dirname, "src/renderer/src"),
      },
    },
    plugins: [react(), tailwindcss()],
    // AGENTPOV_PORT lets a second checkout (a worktree) run beside the main one.
    server: {
      port: Number(process.env.AGENTPOV_PORT ?? 4001),
      strictPort: true,
    },
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, "src/renderer/index.html") },
      },
    },
  },
});
