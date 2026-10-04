import app from "../src/server";
import type { MediaEnv } from "../src/server/media/policy";
import { createMediaIntegrationFake } from "./media-integration-fake";

export { SummaryWorkflow } from "../src/server/extensions/workflows";

let currentConfiguration: MediaEnv;
const FAKE = createMediaIntegrationFake(() => currentConfiguration, {
  isWaiting: true,
});
globalThis.fetch = FAKE.transport;
export default {
  async fetch(
    request: Request,
    configuration: MediaEnv,
    context: ExecutionContext,
  ) {
    currentConfiguration = configuration;
    if (new URL(request.url).pathname === "/__m5-fixture")
      return Response.json({ isSynthetic: true, endpointCount: 12 });
    return app.fetch(request, configuration, context);
  },
} satisfies ExportedHandler<MediaEnv>;
