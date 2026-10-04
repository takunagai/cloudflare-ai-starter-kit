import { cloudflare } from "@cloudflare/vite-plugin";
import { type ConfigEnv, defineConfig, type UserConfig } from "vite";
import starter from "../vite.config.ts";
// アプリを複製せず、同じソースを合成Worker/隔離したD1/R2へbuildする。
export default defineConfig((input) => {
  const config = (starter as (input: ConfigEnv) => UserConfig)(input);
  return {
    ...config,
    plugins: [
      cloudflare({
        configPath: ".wrangler/m4-preview/wrangler.jsonc",
        persistState: { path: ".wrangler/m4-preview/state" },
        inspectorPort: false,
        remoteBindings: false,
        viteEnvironment: { name: "ssr" },
      }),
      ...(config.plugins ?? []).slice(1),
    ],
  };
});
