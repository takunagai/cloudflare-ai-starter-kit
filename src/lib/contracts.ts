import { z } from "zod";

export const healthSchema = z.object({
  status: z.literal("ok"),
  runtime: z.literal("cloudflare-workers"),
});

export const inputSchema = z.strictObject({
  message: z.string().trim().min(1).max(200),
});
