import { cloudflare } from "@cloudflare/vite-plugin";
import { type ConfigEnv, defineConfig, type UserConfig } from "vite";
import starter from "../vite.config.ts";

// 公開OFF成果物を、その場所の新規M-5専用DBだけで確認する。
export default defineConfig((input) => {
  const config = (starter as (input: ConfigEnv) => UserConfig)(input);
  return {
    ...config,
    plugins: [
      cloudflare({
        configPath: "wrangler.jsonc",
        persistState: { path: ".wrangler/m5-off/state" },
        inspectorPort: false,
        remoteBindings: false,
        viteEnvironment: { name: "ssr" },
      }),
      ...(config.plugins ?? []).slice(1),
    ],
  };
});
