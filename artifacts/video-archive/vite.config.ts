import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

const env = loadEnv("development", process.cwd(), "");
const rawPort = env.FRONTEND_PORT || env.PORT;
const port = rawPort ? Number(rawPort) : 3000;
const rawBase = env.VITE_BASE_PATH || env.BASE_PATH || "/";
const basePath = rawBase.startsWith("/") && !rawBase.includes(" ") ? rawBase : "/";

async function getPlugins() {
  const plugins = [
    react(),
    tailwindcss(),
  ];

  if (process.env.REPL_ID !== undefined) {
    try {
      const { default: runtimeErrorOverlay } = await import("@replit/vite-plugin-runtime-error-modal");
      plugins.push(runtimeErrorOverlay());
      const { cartographer } = await import("@replit/vite-plugin-cartographer");
      plugins.push(cartographer({ root: path.resolve(import.meta.dirname, "..") }));
      const { default: devBanner } = await import("@replit/vite-plugin-dev-banner");
      plugins.push(devBanner());
    } catch {
      // Replit plugins not available
    }
  }

  return plugins;
}

export default defineConfig(async () => ({
  base: basePath,
  envPrefix: ["VITE_"],
  plugins: await getPlugins(),
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@assets": path.resolve(import.meta.dirname, "..", "..", "attached_assets"),
    },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist"),
    emptyOutDir: true,
    target: "es2022",
    cssCodeSplit: true,
    rollupOptions: {
      maxParallelFileOps: 2,
      cache: false,
      output: {
        manualChunks(id) {
          if (
            id.includes("/lib/api-client-react/") ||
            id.includes("/lib/api-client/") ||
            id.includes("/lib/api-zod/") ||
            id.includes("/lib/api-spec/")
          ) {
            return "workspace";
          }
          if (
            id.includes("/node_modules/react/") ||
            id.includes("/node_modules/react-dom/") ||
            id.includes("/node_modules/wouter/") ||
            id.includes("/node_modules/scheduler/")
          ) {
            return "vendor";
          }
          if (id.includes("/node_modules/lucide-react/")) {
            return "icons";
          }
          if (id.includes("/node_modules/@radix-ui/")) {
            return "radix";
          }
          if (id.includes("/node_modules/framer-motion/")) {
            return "motion";
          }
          if (id.includes("/node_modules/@tanstack/react-query/")) {
            return "data";
          }
          if (id.includes("/node_modules/recharts/")) {
            return "charts";
          }
          if (id.includes("/node_modules/date-fns/")) {
            return "dates";
          }
          if (id.includes("/node_modules/@supabase/")) {
            return "supabase";
          }
          if (
            id.includes("/node_modules/react-hook-form/") ||
            id.includes("/node_modules/zod/") ||
            id.includes("/node_modules/@hookform/")
          ) {
            return "forms";
          }
          return null;
        },
      },
    },
  },
  server: {
    port,
    strictPort: true,
    host: "0.0.0.0",
    allowedHosts: true,
    fs: { strict: true },
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8080",
        changeOrigin: true,
      },
    },
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8080",
        changeOrigin: true,
      },
    },
  },
}));
