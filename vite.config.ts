import { fileURLToPath, URL } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// https://v2.tauri.app/start/frontend/vite/
const host = process.env.TAURI_DEV_HOST;

export default defineConfig(async () => ({
  plugins: [react(), tailwindcss()],

  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@ui": fileURLToPath(new URL("./src/components/ui", import.meta.url)),
      "@lib": fileURLToPath(new URL("./src/lib", import.meta.url)),
      "@hooks": fileURLToPath(new URL("./src/hooks", import.meta.url)),
      "@components": fileURLToPath(new URL("./src/components", import.meta.url)),
    },
  },

  // Vite options tailored for Tauri development.
  //
  // 1. prevent Vite from obscuring Rust errors
  clearScreen: false,
  // 2. Tauri expects a fixed port, fail if that port is not available
  server: {
    port: 5173,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
