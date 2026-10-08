import { statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import {
  assertResolvedBuildTarget,
  prerenderHelpFor,
  resolveBuildTarget,
} from "./build-policy.ts";

export default defineConfig(({ mode, isPreview }) => {
  const target = resolveBuildTarget(
    mode,
    process.env.CLOUDFLARE_ENV,
    (path) => {
      try {
        return statSync(new URL(path, import.meta.url)).isFile();
      } catch {
        return false;
      }
    },
    isPreview,
  );
  const prerenderHelp = prerenderHelpFor(target);
  return {
    plugins: [
      cloudflare({
        configPath: fileURLToPath(new URL(target.configPath, import.meta.url)),
        config: (config) => {
          if (!isPreview)
            assertResolvedBuildTarget(target, {
              environment: config.targetEnvironment,
              environmentDeclared:
                target.environment === undefined ||
                config.definedEnvironments?.includes(target.environment) ===
                  true,
              appEnvironment: config.vars.APP_ENV,
              stagingPolicy: config.vars.STAGING_POLICY,
            });
        },
        viteEnvironment: { name: "ssr" },
        inspectorPort: false,
      }),
      tanstackStart({
        prerender: {
          enabled: prerenderHelp,
          autoStaticPathsDiscovery: false,
          crawlLinks: false,
        },
        pages: prerenderHelp
          ? [{ path: "/help", prerender: { enabled: true } }]
          : [],
      }),
      react(),
      tailwindcss(),
    ],
  };
});
