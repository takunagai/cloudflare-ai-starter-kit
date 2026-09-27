import { describe, expect, it } from "vitest";
import { getAuthMailer } from "../src/server/auth";
import { createCloudflareMailer } from "../src/server/auth/email";
import type { AppEnv } from "../src/server/env";

describe("Cloudflare Email Sending boundary", () => {
  const origin = "https://starter.example.test";
  const fakeUrl = `${origin}/api/auth/verify-email?token=test-fixture&callbackURL=%2Fapp`;
  it("builds text and escaped HTML using a fake binding", async () => {
    const sent: EmailMessageBuilder[] = [];
    const binding = {
      async send(message: EmailMessageBuilder) {
        sent.push(message);
        return { messageId: "fake-message" };
      },
    } as SendEmail;
    const mailer = createCloudflareMailer({
      EMAIL: binding,
      EMAIL_FROM: "noreply@example.test",
      APP_ORIGIN: origin,
    });
    await mailer?.send({
      to: "alice@example.test",
      purpose: "verification",
      url: fakeUrl,
    });
    expect(sent.length).toBe(1);
    expect(sent[0].to).toBe("alice@example.test");
    expect(sent[0].subject).toBe("メールアドレスを確認してください");
    expect(sent[0].text?.includes(fakeUrl)).toBe(true);
    expect(sent[0].html?.includes("&amp;callbackURL")).toBe(true);
  });
  it("rejects partial configuration, email header injection, and external links", async () => {
    expect(createCloudflareMailer({ APP_ORIGIN: origin })).toBeUndefined();
    expect(() =>
      createCloudflareMailer({
        EMAIL_FROM: "noreply@example.test",
        APP_ORIGIN: origin,
      }),
    ).toThrow("Authentication is not configured");
    let count = 0;
    const binding = {
      async send() {
        count++;
        return { messageId: "fake-message" };
      },
    } as SendEmail;
    const mailer = createCloudflareMailer({
      EMAIL: binding,
      EMAIL_FROM: "noreply@example.test",
      APP_ORIGIN: origin,
    });
    await expect(
      mailer?.send({
        to: "a@example.test\r\nBcc:bad@example.test",
        purpose: "verification",
        url: fakeUrl,
      }),
    ).rejects.toThrow();
    await expect(
      mailer?.send({
        to: "a@example.test",
        purpose: "password-reset",
        url: "https://attacker.test/reset",
      }),
    ).rejects.toThrow();
    expect(count).toBe(0);
  });
  it("replaces a delivery exception with a fixed safe error", async () => {
    const binding = {
      async send() {
        throw new Error("fixture-only-provider-detail");
      },
    } as SendEmail;
    const mailer = createCloudflareMailer({
      EMAIL: binding,
      EMAIL_FROM: "noreply@example.test",
      APP_ORIGIN: origin,
    });
    await expect(
      mailer?.send({
        to: "a@example.test",
        purpose: "password-reset",
        url: fakeUrl,
      }),
    ).rejects.toThrow("auth_email_delivery_failed");
  });
  it("does not connect local auth to Wrangler email logging or a remote send binding", () => {
    const binding = {
      async send() {
        throw new Error("must not be called");
      },
    } as SendEmail;
    expect(
      getAuthMailer({
        APP_ENV: "local",
        APP_ORIGIN: "http://127.0.0.1:3000",
        EMAIL: binding,
        EMAIL_FROM: "noreply@example.test",
      } as AppEnv),
    ).toBeUndefined();
  });
});
