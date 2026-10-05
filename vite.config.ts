import path from "node:path";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  // Deployments build from the generated wrangler.deploy.json; see scripts/configure-deploy.mjs.
  plugins: [
    cloudflare({ configPath: process.env.HOURLARK_WRANGLER_CONFIG || undefined }),
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
  },
  build: {
    sourcemap: true,
  },
});
