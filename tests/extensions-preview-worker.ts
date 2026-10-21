import { AUDIO_ENDPOINTS } from "../src/lib/media-audio-options";
import { IMAGE_ENDPOINTS } from "../src/lib/media-image-options";
import { VIDEO_ENDPOINTS } from "../src/lib/media-video-options";
import app from "../src/server";
import type { AppEnv } from "../src/server/env";
import { MEDIA_MODEL_IDS } from "../src/server/media/catalog";
import type { MediaEnv } from "../src/server/media/policy";
import { createMediaIntegrationFake } from "./media-integration-fake";

export { SummaryWorkflow } from "../src/server/extensions/workflows";

// 全拡張ONの画面確認用。外部fetchは合成fakeだけが受け、他はすべて拒否する。
// media設定とfalキーはTEST_ONLYの合成値。実Secretと実モデルは使わない。
let currentConfiguration: AppEnv & MediaEnv;
const FAKE = createMediaIntegrationFake(() => currentConfiguration, {
  isWaiting: true,
});
globalThis.fetch = FAKE.transport;
export default {
  async fetch(
    request: Request,
    configuration: AppEnv,
    context: ExecutionContext,
  ) {
    currentConfiguration = {
      ...configuration,
      MEDIA_ALLOWED_MODELS: JSON.stringify(MEDIA_MODEL_IDS),
      MEDIA_VERIFIED_IMAGE_MODELS: JSON.stringify(IMAGE_ENDPOINTS),
      MEDIA_VERIFIED_VIDEO_MODELS: JSON.stringify(VIDEO_ENDPOINTS),
      MEDIA_VERIFIED_AUDIO_MODELS: JSON.stringify(AUDIO_ENDPOINTS),
      FAL_KEY: "TEST_ONLY_dummy_fal_key",
    } as AppEnv & MediaEnv;
    if (new URL(request.url).pathname === "/__extensions-preview")
      return Response.json({ isSynthetic: true });
    return app.fetch(request, currentConfiguration, context);
  },
} satisfies ExportedHandler<AppEnv>;
