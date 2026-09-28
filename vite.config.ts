import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig(({ mode }) => ({
  plugins: [
    cloudflare({
      configPath:
        mode === "staging-local"
          ? ".wrangler.staging.local.jsonc"
          : "wrangler.jsonc",
      viteEnvironment: { name: "ssr" },
      inspectorPort: false,
    }),
    tanstackStart({
      prerender: {
        enabled: true,
        autoStaticPathsDiscovery: false,
        crawlLinks: false,
      },
      pages: [{ path: "/help", prerender: { enabled: true } }],
    }),
    react(),
    tailwindcss(),
  ],
}));
