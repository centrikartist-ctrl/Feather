import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDb, initDb } from "../db/index.js";
import { budgets } from "../db/schema.js";
import { getDb } from "../db/index.js";
import { BudgetService } from "./index.js";
import { BudgetExceededError } from "@feather/shared";

let tempDir: string;
let service: BudgetService;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "feather-budget-test-"));
  initDb(path.join(tempDir, "test.db"));
  service = new BudgetService();
});

afterEach(() => {
  closeDb();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("BudgetService", () => {
  it("blocks when the daily budget is exceeded", async () => {
    const db = getDb();
    await db.insert(budgets).values({
      id: "global-budget",
      scope: "global",
      dailyLimitCents: 10,
      taskLimitCents: 5,
      monthlyLimitCents: null,
      providerId: null,
      projectId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    await service.recordCost({ providerId: "test-provider", estimatedCents: 10 });

    await expect(service.checkDailyBudget()).rejects.toBeInstanceOf(BudgetExceededError);
  });
});