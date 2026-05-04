import { describe, expect, it } from "vitest";
import { TelegramConnector } from "./index.js";

const services = {
  approvals: {} as never,
  projects: {} as never,
  tasks: {} as never,
  budgets: {} as never,
  heartbeat: {} as never,
  providers: {} as never,
};

describe("TelegramConnector allowlist", () => {
  it("accepts configured Telegram user IDs and rejects unknown users", () => {
    const connector = new TelegramConnector(
      { botToken: "test-token", allowedUserIds: [123, 456] },
      services,
    );

    expect(connector.isAllowedUser(123)).toBe(true);
    expect(connector.isAllowedUser(999)).toBe(false);
    expect(connector.isAllowedUser(undefined)).toBe(false);
  });

  it("allows only safe commands during panic mode", () => {
    const connector = new TelegramConnector(
      { botToken: "test-token", allowedUserIds: [123, 456] },
      services,
    );

    expect((connector as any).isAllowedDuringPanic("/status", [])).toBe(true);
    expect((connector as any).isAllowedDuringPanic("/task", ["proj", "do", "work"])).toBe(false);
    expect((connector as any).isAllowedDuringPanic("/approve", ["abc"])).toBe(false);
    expect((connector as any).isAllowedDuringPanic("/reject", ["abc"])).toBe(true);
    expect((connector as any).isAllowedDuringPanic("/heartbeat", ["proj", "off"])).toBe(true);
  });
});