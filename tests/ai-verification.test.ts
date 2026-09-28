import { env as testBindings } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  chatSystemPrompt,
  checkVerificationInput,
  type VerificationEnv,
  verificationDuration,
  verificationSettings,
  verificationStatus,
} from "../src/server/ai-verification";

const startedAt = Date.parse("2026-09-28T23:50:00.000Z");
const database = testBindings.DB;
if (!database) throw new Error("local_test_database_missing");
function settings(overrides: Partial<VerificationEnv> = {}): VerificationEnv {
  return {
    DB: database,
    APP_ENV: "staging",
    AUTH_MODE: "access",
    AI: {
      run: vi.fn(() => {
        throw new Error("inference_forbidden");
      }),
    } as unknown as Ai,
    AI_VERIFICATION_ENABLED: "true",
    AI_VERIFICATION_START: new Date(startedAt).toISOString(),
    LOCAL_DEMO: "false",
    ENABLE_RAG: "false",
    ENABLE_AGENT: "false",
    ENABLE_WORKFLOWS: "false",
    ENABLE_IMAGES: "false",
    ENABLE_BILLING: "false",
    ...overrides,
  } as VerificationEnv;
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(startedAt);
  await database.prepare("DELETE FROM ai_verification").run();
});
afterEach(() => vi.useRealTimers());

describe("verification configuration proposal", () => {
  it("uses one fixed window across midnight", () => {
    const config = settings();
    const expected = { startedAt, expiresAt: startedAt + verificationDuration };
    expect(verificationSettings(config)).toEqual(expected);
    vi.setSystemTime(startedAt + 20 * 60000);
    expect(verificationSettings(config)).toEqual(expected);
    vi.setSystemTime(startedAt + verificationDuration);
    expect(() => verificationSettings(config)).toThrow(
      "verification_outside_window",
    );
    vi.setSystemTime(startedAt - 1);
    expect(() => verificationSettings(config)).toThrow(
      "verification_outside_window",
    );
  });

  it.each<Partial<VerificationEnv>>([
    { AI_VERIFICATION_ENABLED: undefined },
    { AI_VERIFICATION_ENABLED: "false" },
    { AI_VERIFICATION_START: "not-a-date" },
    { AI_VERIFICATION_START: "2026-09-28" },
    { APP_ENV: "local" },
    { APP_ENV: "production" },
    { AUTH_MODE: "better-auth" },
    { AI: undefined },
    { LOCAL_DEMO: "true" },
    { ENABLE_RAG: "true" },
    { ENABLE_AGENT: "true" },
    { ENABLE_WORKFLOWS: "true" },
    { ENABLE_IMAGES: "true" },
    { ENABLE_BILLING: "true" },
    { ENABLE_BILLING: undefined },
  ])("fails closed for unsafe configuration %#", (overrides) => {
    expect(() => verificationSettings(settings(overrides))).toThrow(
      "verification_not_ready",
    );
  });

  it("leaves unconfigured local and production outside the profile", () => {
    for (const APP_ENV of ["local", "production"] as const) {
      expect(
        verificationSettings(
          settings({
            APP_ENV,
            AI_VERIFICATION_ENABLED: undefined,
            AI_VERIFICATION_START: undefined,
          }),
        ),
      ).toBeNull();
    }
  });

  it("checks exact UTF-8 aggregate boundary including system and history", () => {
    const available =
      4096 - new TextEncoder().encode(chatSystemPrompt).byteLength;
    const history = [
      { role: "user" as const, content: "test" },
      { role: "assistant" as const, content: "x".repeat(available - 4 - 3) },
    ];
    expect(() => checkVerificationInput("玉", history)).not.toThrow();
    expect(() => checkVerificationInput("玉a", history)).toThrow(
      "verification_input_bytes_limit",
    );
    expect(() => checkVerificationInput("a".repeat(201), [])).toThrow(
      "verification_input_too_long",
    );
    expect(() => checkVerificationInput("a".repeat(200), [])).not.toThrow();
  });

  it("rejects partial, reordered or excess history without truncation", () => {
    const user = { role: "user" as const, content: "test" };
    const assistant = { role: "assistant" as const, content: "reply" };
    for (const history of [
      [user],
      [assistant, user],
      [user, assistant, user],
    ]) {
      expect(() => checkVerificationInput("test", history)).toThrow(
        "verification_history_limit",
      );
    }
  });

  it("reads a persistent allowance without exposing the owner or creating/resetting it", async () => {
    const config = settings();
    expect(await verificationStatus(config, "test-owner")).toMatchObject({
      ready: true,
      remaining: 3,
    });
    expect(
      await database.prepare("SELECT id FROM ai_verification").first(),
    ).toBeNull();
    await database
      .prepare("INSERT INTO ai_verification VALUES (1,?,?,?,2)")
      .bind("test-owner", startedAt, startedAt + verificationDuration)
      .run();
    const status = await verificationStatus(config, "test-owner");
    expect(status).toEqual({
      ready: true,
      remaining: 1,
      expiresAt: startedAt + verificationDuration,
    });
    expect(JSON.stringify(status)).not.toContain("test-owner");
    expect(
      await verificationStatus(config, "different-test-owner"),
    ).toMatchObject({ ready: false, remaining: 0 });
    vi.setSystemTime(startedAt + 60000);
    expect(
      await verificationStatus(
        settings({
          AI_VERIFICATION_START: new Date(startedAt + 60000).toISOString(),
        }),
        "test-owner",
      ),
    ).toMatchObject({ ready: false, remaining: 0 });
    await database.prepare("UPDATE ai_verification SET attempts=3").run();
    expect(await verificationStatus(config, "test-owner")).toMatchObject({
      ready: false,
      remaining: 0,
    });
  });
});
