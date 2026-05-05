import { describe, expect, it, vi } from "vitest";
import { FEATHER_BASE_URL } from "@feather/shared";
import { requestJson, resolveApiBaseUrl } from "./api-client.js";

describe("dashboard api client", () => {
  it("defaults to the Feather daemon base URL in dev", () => {
    expect(resolveApiBaseUrl({ DEV: true })).toBe(FEATHER_BASE_URL);
    expect(resolveApiBaseUrl({ DEV: true, VITE_FEATHER_API_BASE_URL: "http://127.0.0.1:9999/" })).toBe("http://127.0.0.1:9999");
    expect(resolveApiBaseUrl({ DEV: false })).toBe("");
  });

  it("rejects html responses with a daemon-focused message", async () => {
    const fetchImpl = vi.fn(async () => new Response("<!doctype html><html></html>", {
      status: 200,
      headers: { "Content-Type": "text/html" },
    }));

    await expect(requestJson("/onboarding/state", undefined, { apiBaseUrl: FEATHER_BASE_URL, fetchImpl })).rejects.toThrow(
      "Expected JSON from Feather daemon but received HTML. Check VITE_FEATHER_API_BASE_URL or daemon status.",
    );
  });

  it("reports daemon unreachable instead of surfacing a raw fetch error", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });

    await expect(requestJson("/health", undefined, { apiBaseUrl: FEATHER_BASE_URL, fetchImpl })).rejects.toThrow(
      `Feather daemon not reachable at ${FEATHER_BASE_URL}`,
    );
  });
});