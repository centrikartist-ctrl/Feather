import { describe, expect, it } from "vitest";
import { classifyHealth } from "./health.js";

describe("classifyHealth", () => {
  it("classifies unreachable gateways as unreachable", () => {
    expect(classifyHealth({ reachable: false, error: "ECONNREFUSED" })).toBe("unreachable");
  });

  it("treats failed diagnostics as critical", () => {
    expect(classifyHealth({
      reachable: true,
      health: { status: "healthy" },
      diagnostic: { diagnosticId: "diag", result: "fail", checks: { dbRead: "fail" } },
    })).toBe("critical");
  });

  it("preserves maintenance and safe mode status", () => {
    expect(classifyHealth({ reachable: true, health: { status: "maintenance" } })).toBe("maintenance");
    expect(classifyHealth({ reachable: true, health: { status: "safe_mode" } })).toBe("safe_mode");
  });
});
