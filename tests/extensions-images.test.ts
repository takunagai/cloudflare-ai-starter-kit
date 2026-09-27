import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppEnv, Identity } from "../src/server/env";
import {
  cancelImage,
  getImage,
  imageInputSchema,
  submitImage,
} from "../src/server/extensions/images";

const base = env as unknown as AppEnv;
const app = { ...base, ENABLE_IMAGES: "true", FAL_KEY: "test-only-dummy-key" };
const alice: Identity = {
  id: "image-alice",
  email: "alice@example.test",
  name: "Alice",
};
const bob: Identity = {
  id: "image-bob",
  email: "bob@example.test",
  name: "Bob",
};
const providerId = "provider-request-1";
const providerBase = `https://queue.fal.run/fal-ai/flux/requests/${providerId}`;
const accepted = () =>
  Response.json({
    request_id: providerId,
    status_url: `${providerBase}/status`,
    response_url: providerBase,
    cancel_url: `${providerBase}/cancel`,
  });
const input = () =>
  imageInputSchema.parse({
    requestId: crypto.randomUUID(),
    model: "fal-ai/flux/schnell",
    prompt: "a blue bowl",
    size: "square",
  });

beforeEach(async () => {
  await base.DB.prepare("DELETE FROM image_jobs").run();
});

describe("fal queue with fake network and real D1 ownership", () => {
  it("reserves concurrent duplicate requests once and enforces server-side generation limits", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => accepted());
    const request = input();
    const [first, duplicate] = await Promise.all([
      submitImage(app, alice, request, fetcher),
      submitImage(app, alice, request, fetcher),
    ]);
    expect(first.id).toBe(duplicate.id);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const sent = JSON.parse(String(fetcher.mock.calls[0][1]?.body));
    expect(sent).toMatchObject({
      num_images: 1,
      num_inference_steps: 4,
      enable_safety_checker: true,
      image_size: "square",
    });
    await expect(
      submitImage(app, alice, { ...request, prompt: "different" }, fetcher),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      submitImage(app, alice, input(), fetcher),
    ).rejects.toMatchObject({ status: 429 });
  });

  it("rejects unapproved models/counts/sizes before a provider call", async () => {
    expect(
      imageInputSchema.safeParse({ ...input(), model: "fal-ai/other" }).success,
    ).toBe(false);
    expect(
      imageInputSchema.safeParse({ ...input(), num_images: 8 }).success,
    ).toBe(false);
    expect(
      imageInputSchema.safeParse({
        ...input(),
        size: { width: 8192, height: 8192 },
      }).success,
    ).toBe(false);
  });

  it("checks owner before polling or cancelling, then returns a bounded completed image", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(accepted());
    const job = await submitImage(app, alice, input(), fetcher);
    await expect(getImage(app, bob, job.id, fetcher)).rejects.toMatchObject({
      status: 404,
    });
    await expect(cancelImage(app, bob, job.id, fetcher)).rejects.toMatchObject({
      status: 404,
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    fetcher
      .mockResolvedValueOnce(Response.json({ status: "COMPLETED" }))
      .mockResolvedValueOnce(
        Response.json({
          images: [
            {
              url: "https://v3.fal.media/files/test.png",
              width: 512,
              height: 512,
            },
          ],
        }),
      );
    expect(await getImage(app, alice, job.id, fetcher)).toMatchObject({
      state: "completed",
      image: { width: 512, height: 512 },
    });
    await getImage(app, alice, job.id, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("retains uncertain submission without automatically charging for a second request", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error("connection lost"));
    const request = input();
    await expect(
      submitImage(app, alice, request, fetcher),
    ).rejects.toMatchObject({ status: 502 });
    expect(await submitImage(app, alice, request, fetcher)).toMatchObject({
      state: "submission_unknown",
    });
    await expect(
      submitImage(app, alice, input(), fetcher),
    ).rejects.toMatchObject({
      status: 429,
      code: "IMAGE_LIMIT_REACHED",
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("never follows provider-supplied URLs outside the allowed queue endpoint", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        request_id: providerId,
        status_url: "https://attacker.test/steal",
        response_url: providerBase,
        cancel_url: `${providerBase}/cancel`,
      }),
    );
    await expect(
      submitImage(app, alice, input(), fetcher),
    ).rejects.toMatchObject({ code: "IMAGE_PROVIDER_RESPONSE_INVALID" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("distinguishes a cancellation request from proof the job stopped", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(accepted());
    const job = await submitImage(app, alice, input(), fetcher);
    fetcher.mockResolvedValueOnce(
      Response.json({ status: "CANCELLATION_REQUESTED" }, { status: 202 }),
    );
    expect(await cancelImage(app, alice, job.id, fetcher)).toMatchObject({
      state: "cancel_requested",
    });
    fetcher.mockResolvedValueOnce(Response.json({ status: "IN_PROGRESS" }));
    expect(await getImage(app, alice, job.id, fetcher)).toMatchObject({
      state: "cancel_requested",
    });
  });

  it("marks overdue jobs timed_out while retaining polling and cancellation", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(accepted());
    const job = await submitImage(app, alice, input(), fetcher);
    await base.DB.prepare("UPDATE image_jobs SET created_at = ? WHERE id = ?")
      .bind(Date.now() - 610_000, job.id)
      .run();
    fetcher.mockResolvedValueOnce(Response.json({ status: "IN_PROGRESS" }));
    expect(await getImage(app, alice, job.id, fetcher)).toMatchObject({
      state: "timed_out",
    });
    fetcher.mockResolvedValueOnce(
      Response.json({ status: "COMPLETED", error: "private upstream error" }),
    );
    const failed = await getImage(app, alice, job.id, fetcher);
    expect(failed).toMatchObject({ state: "failed" });
    expect(JSON.stringify(failed)).not.toContain("private upstream");
  });

  it("does not overwrite an accepted cancel with a concurrent older poll", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(accepted());
    const job = await submitImage(app, alice, input(), fetcher);
    let releaseStatus: (value: Response) => void = () => {
      throw new Error("not started");
    };
    let markStarted: () => void = () => {
      throw new Error("not initialized");
    };
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    fetcher.mockImplementationOnce(async () => {
      markStarted();
      return new Promise<Response>((resolve) => {
        releaseStatus = resolve;
      });
    });
    const polling = getImage(app, alice, job.id, fetcher);
    await started;
    const cancelFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json({ status: "CANCELLATION_REQUESTED" }, { status: 202 }),
      );
    await cancelImage(app, alice, job.id, cancelFetch);
    releaseStatus(Response.json({ status: "IN_PROGRESS" }));
    expect(await polling).toMatchObject({ state: "cancel_requested" });
  });

  it("allows retrying a transient result fetch failure without another submission", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(accepted());
    const job = await submitImage(app, alice, input(), fetcher);
    fetcher
      .mockResolvedValueOnce(Response.json({ status: "COMPLETED" }))
      .mockResolvedValueOnce(new Response(null, { status: 503 }));
    await expect(getImage(app, alice, job.id, fetcher)).rejects.toMatchObject({
      code: "IMAGE_RESULT_UNAVAILABLE",
    });
    fetcher
      .mockResolvedValueOnce(Response.json({ status: "COMPLETED" }))
      .mockResolvedValueOnce(
        Response.json({
          images: [
            { url: "https://fal.media/test.png", width: 512, height: 512 },
          ],
        }),
      );
    expect(await getImage(app, alice, job.id, fetcher)).toMatchObject({
      state: "completed",
    });
  });
});
