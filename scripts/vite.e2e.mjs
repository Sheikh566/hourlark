import path from "node:path";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const statePath = process.env.HOURLARK_E2E_STATE;
if (!statePath) throw new Error("Start the browser runtime with scripts/e2e-server.mjs.");

export default defineConfig({
  plugins: [
    cloudflare({ persistState: { path: statePath }, inspectorPort: false }),
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "../src") },
  },
  build: { sourcemap: true },
});
