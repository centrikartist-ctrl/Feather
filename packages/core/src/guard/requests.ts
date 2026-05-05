import fs from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";
import { z } from "zod";
import { getFeatherHomeDir } from "../config/index.js";

export const LifecycleRequestSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("RESTART_REQUEST"),
    requestedBy: z.string().min(1),
    reason: z.string().min(1),
    createdAt: z.string().datetime().optional(),
  }),
  z.object({
    type: z.literal("PANIC_REQUEST"),
    requestedBy: z.string().min(1),
    reason: z.string().min(1),
    createdAt: z.string().datetime().optional(),
  }),
  z.object({
    type: z.literal("SNAPSHOT_REQUEST"),
    requestedBy: z.string().min(1),
    reason: z.string().min(1),
    createdAt: z.string().datetime().optional(),
  }),
]);

export type LifecycleRequest = z.infer<typeof LifecycleRequestSchema>;

export function getLifecycleRequestsDir(): string {
  return path.join(getFeatherHomeDir(), "requests");
}

export function writeLifecycleRequest(input: LifecycleRequest): { id: string; path: string; request: LifecycleRequest } {
  const request = LifecycleRequestSchema.parse({
    ...input,
    createdAt: input.createdAt ?? new Date().toISOString(),
  });
  const dir = getLifecycleRequestsDir();
  fs.mkdirSync(dir, { recursive: true });
  const id = `${request.type.toLowerCase().replaceAll("_", "-")}-${Date.now()}-${nanoid(8)}`;
  const filePath = path.join(dir, `${id}.json`);
  fs.writeFileSync(filePath, `${JSON.stringify(request, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  return { id, path: filePath, request };
}
