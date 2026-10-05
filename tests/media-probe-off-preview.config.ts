import { cloudflare } from "@cloudflare/vite-plugin";
import { type ConfigEnv, defineConfig, type UserConfig } from "vite";
import starter from "../vite.config.ts";
export default defineConfig((input) => {
  const config = (starter as (input: ConfigEnv) => UserConfig)(input);
  return {
    ...config,
    envDir: false,
    plugins: [
      cloudflare({
        configPath: ".wrangler/e-off/wrangler.jsonc",
        persistState: { path: ".wrangler/e-off/state" },
        inspectorPort: false,
        remoteBindings: false,
        viteEnvironment: { name: "ssr" },
      }),
      ...(config.plugins ?? []).slice(1),
    ],
  };
});
