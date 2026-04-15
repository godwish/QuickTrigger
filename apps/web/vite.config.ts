import path from "node:path";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

const currentDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  return {
    root: currentDir,
    plugins: [react()],
    server: {
      host: "0.0.0.0",
      port: 5173,
      proxy: {
        "/api": {
          target: env.VITE_PROXY_TARGET || "http://localhost:4000",
          changeOrigin: true
        }
      }
    },
    build: {
      outDir: path.resolve(currentDir, "../../dist/web"),
      emptyOutDir: true
    },
    resolve: {
      alias: {
        "@": path.resolve(currentDir, "src")
      }
    }
  };
});
