import { cloudflare } from "@cloudflare/vite-plugin";
import { type ConfigEnv, defineConfig, type UserConfig } from "vite";
import starter from "../vite.config.ts";

// M-5だけの新規隔離状態。M-4/D-2や元利用DBを使わない。
export default defineConfig((input) => {
  const config = (starter as (input: ConfigEnv) => UserConfig)(input);
  return {
    ...config,
    plugins: [
      cloudflare({
        configPath: ".wrangler/m5-preview/wrangler.jsonc",
        persistState: { path: ".wrangler/m5-preview/state" },
        inspectorPort: false,
        remoteBindings: false,
        viteEnvironment: { name: "ssr" },
      }),
      ...(config.plugins ?? []).slice(1),
    ],
  };
});
