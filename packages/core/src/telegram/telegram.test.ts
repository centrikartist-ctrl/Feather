import path from "node:path";
import os from "node:os";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { Approval, Observation, Project, Task } from "@feather/shared";
import { closeDb, initDb } from "../db/index.js";
import { _resetPanicForTesting, activatePanic, deactivatePanic } from "../panic/index.js";
import { TelegramConnector, classifyTelegramFreeformIntent } from "./index.js";

function createProject(id: string, name = id): Project {
  return {
    id,
    name,
    rootPath: `C:/tmp/${id}`,
    heartbeatEnabled: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function createApproval(id: string): Approval {
  return {
    id,
    title: `Approval ${id}`,
    reason: "needs approval",
    actionType: "filesystem",
    risk: "review",
    payload: {},
    status: "pending",
    createdAt: new Date().toISOString(),
  };
}

function createTask(id: string, title = id): Task {
  return {
    id,
    title,
    prompt: title,
    status: "queued",
    providerId: "provider-1",
    createdBy: "telegram",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function createObservation(title: string): Observation {
  return {
    id: `obs-${title}`,
    source: "heartbeat",
    severity: "suggestion",
    title,
    body: title,
    suggestedActions: [],
    createdAt: new Date().toISOString(),
  };
}

function createServices(options: {
  projects?: Project[];
  approvals?: Approval[];
  tasks?: Task[];
  observations?: Observation[];
} = {}) {
  const state = {
    projects: options.projects ?? [createProject("feather", "Feather")],
    approvals: options.approvals ?? [],
    tasks: options.tasks ?? [],
    observations: options.observations ?? [createObservation("Docs are stale")],
  };

  const services = {
    approvals: {
      getPendingApprovals: vi.fn(async () => state.approvals),
      resolveApproval: vi.fn(async (id: string, decision: "approved" | "rejected") => ({
        ...createApproval(id),
        status: decision,
      })),
    },
    projects: {
      listProjects: vi.fn(async () => state.projects),
      getProject: vi.fn(async (id: string) => {
        const project = state.projects.find((item) => item.id === id);
        if (!project) {
          throw new Error(`Project not found: ${id}`);
        }
        return project;
      }),
    },
    tasks: {
      createTask: vi.fn(async (input: { prompt: string; projectId?: string; providerId: string }) => createTask("task-1", input.prompt)),
      runTask: vi.fn(),
      cancelTask: vi.fn(async () => undefined),
      cancelAllActive: vi.fn(async () => undefined),
      listTasks: vi.fn(async () => state.tasks),
    },
    budgets: {
      getDailySpendCents: vi.fn(async () => 123),
    },
    heartbeat: {
      start: vi.fn(),
      stop: vi.fn(),
      generateDailyRecap: vi.fn(async () => "Daily recap"),
      getObservations: vi.fn(async () => state.observations),
    },
    providers: {
      list: vi.fn(() => [{ id: "provider-1" }]),
    },
    memories: {
      list: vi.fn(async () => []),
      create: vi.fn(async (input: { scope: "global" | "project"; kind: string; content: string; projectId?: string }) => ({
        id: "memory-1",
        ...input,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })),
      delete: vi.fn(async () => undefined),
    },
    skills: {
      list: vi.fn(async () => [{ id: "project:feather:safe-ui-pass", name: "Safe UI Pass", scope: "project", projectId: "feather", path: "C:/skills/safe-ui-pass.md", purpose: "", allowedTools: ["filesystem.readFile"], instructions: "Preserve routing." }]),
    },
  };

  return { services, state };
}

function createConnector(overrides: ReturnType<typeof createServices>["services"]) {
  const sentMessages: Array<{ chatId: number; text: string }> = [];
  const connector = new TelegramConnector(
    {
      botToken: "test-token",
      allowedUserIds: [123, 456],
      allowSingleProviderAutoRoute: true,
    },
    overrides as never,
    {
      sendMessage: async (chatId, text) => {
        sentMessages.push({ chatId, text });
      },
      getUpdates: async () => [],
    },
  );

  return { connector, sentMessages };
}

describe("TelegramConnector allowlist", () => {
  beforeEach(() => {
    initDb(path.join(os.tmpdir(), `feather-telegram-${Date.now()}-${Math.random()}.db`));
    _resetPanicForTesting();
  });

  afterEach(() => {
    closeDb();
    _resetPanicForTesting();
  });

  it("accepts configured Telegram user IDs and rejects unknown users", () => {
    const { services } = createServices();
    const connector = new TelegramConnector(
      { botToken: "test-token", allowedUserIds: [123, 456] },
      services as never,
    );

    expect(connector.isAllowedUser(123)).toBe(true);
    expect(connector.isAllowedUser(999)).toBe(false);
    expect(connector.isAllowedUser(undefined)).toBe(false);
  });

  it("allows only safe commands during panic mode", () => {
    const { services } = createServices();
    const connector = new TelegramConnector(
      { botToken: "test-token", allowedUserIds: [123, 456] },
      services as never,
    );

    expect((connector as any).isAllowedDuringPanic("/status", [])).toBe(true);
    expect((connector as any).isAllowedDuringPanic("/task", ["proj", "do", "work"])).toBe(false);
    expect((connector as any).isAllowedDuringPanic("/approve", ["abc"])).toBe(false);
    expect((connector as any).isAllowedDuringPanic("/reject", ["abc"])).toBe(true);
    expect((connector as any).isAllowedDuringPanic("/actions", [])).toBe(true);
    expect((connector as any).isAllowedDuringPanic("/menu", [])).toBe(true);
    expect((connector as any).isAllowedDuringPanic("/examples", [])).toBe(true);
    expect((connector as any).isAllowedDuringPanic("/heartbeat", ["proj", "off"])).toBe(true);
  });

  it("classifies plain status as a read-only question", () => {
    const intent = classifyTelegramFreeformIntent("status", {
      projects: [createProject("feather", "Feather")],
      pendingApprovals: [],
    });

    expect(intent).toEqual({ type: "read_only_question", question: "status", projectId: undefined });
  });

  it("keeps slash commands working through the existing command path", async () => {
    const { services } = createServices();
    const { connector, sentMessages } = createConnector(services);

    await connector.receiveTextMessage({ chatId: 1, userId: 123, text: "/status" });

    expect(sentMessages.at(-1)?.text).toContain("Feather Status");
  });

  it("returns grouped action help for /actions and /menu", async () => {
    const { services } = createServices();
    const { connector, sentMessages } = createConnector(services);

    await connector.receiveTextMessage({ chatId: 1, userId: 123, text: "/actions" });
    await connector.receiveTextMessage({ chatId: 1, userId: 123, text: "/menu" });

    expect(sentMessages.at(-2)?.text).toContain("Feather Actions");
    expect(sentMessages.at(-2)?.text).toContain("*Read-only*");
    expect(sentMessages.at(-2)?.text).toContain("run feather-supervisor status locally");
    expect(sentMessages.at(-1)?.text).toContain("Feather Actions");
  });

  it("returns copyable examples for /examples", async () => {
    const { services } = createServices();
    const { connector, sentMessages } = createConnector(services);

    await connector.receiveTextMessage({ chatId: 1, userId: 123, text: "/examples" });

    expect(sentMessages.at(-1)?.text).toContain("Feather Examples");
    expect(sentMessages.at(-1)?.text).toContain("what's going on with Feather?");
    expect(sentMessages.at(-1)?.text).toContain("/task Feather fix the README alpha wording");
    expect(sentMessages.at(-1)?.text).toContain("approve task");
  });

  it("includes discovery commands in /help", async () => {
    const { services } = createServices();
    const { connector, sentMessages } = createConnector(services);

    await connector.receiveTextMessage({ chatId: 1, userId: 123, text: "/help" });

    expect(sentMessages.at(-1)?.text).toContain("/actions — Grouped operator view");
    expect(sentMessages.at(-1)?.text).toContain("/menu — Alias for /actions");
    expect(sentMessages.at(-1)?.text).toContain("/examples — Copyable slash and freeform examples");
  });

  it("keeps help, actions, menu, and examples available during panic mode", async () => {
    const { services } = createServices();
    const { connector, sentMessages } = createConnector(services);

    await activatePanic("test panic");
    try {
      await connector.receiveTextMessage({ chatId: 1, userId: 123, text: "/help" });
      await connector.receiveTextMessage({ chatId: 1, userId: 123, text: "/actions" });
      await connector.receiveTextMessage({ chatId: 1, userId: 123, text: "/menu" });
      await connector.receiveTextMessage({ chatId: 1, userId: 123, text: "/examples" });
    } finally {
      await deactivatePanic();
    }

    expect(sentMessages.at(-4)?.text).toContain("Feather Commands");
    expect(sentMessages.at(-3)?.text).toContain("Feather Actions");
    expect(sentMessages.at(-2)?.text).toContain("Feather Actions");
    expect(sentMessages.at(-1)?.text).toContain("Feather Examples");
  });

  it("respects the freeform enabled flag", async () => {
    const { services } = createServices();
    const sentMessages: Array<{ chatId: number; text: string }> = [];
    const connector = new TelegramConnector(
      {
        botToken: "test-token",
        allowedUserIds: [123, 456],
        allowSingleProviderAutoRoute: true,
        freeform: { enabled: false },
      },
      services as never,
      {
        sendMessage: async (chatId, text) => {
          sentMessages.push({ chatId, text });
        },
        getUpdates: async () => [],
      },
    );

    await connector.receiveTextMessage({ chatId: 1, userId: 123, text: "status" });

    expect(sentMessages.at(-1)?.text).toContain("Plain Telegram messages are disabled");
  });

  it("returns a freeform status summary for plain status", async () => {
    const { services } = createServices({ tasks: [createTask("task-1", "Fix docs")], approvals: [createApproval("approval-1")] });
    const { connector, sentMessages } = createConnector(services);

    await connector.receiveTextMessage({ chatId: 1, userId: 123, text: "what's going on with Feather?" });

    expect(sentMessages.at(-1)?.text).toContain("Project: Feather");
    expect(sentMessages.at(-1)?.text).toContain("Pending approvals: 1");
  });

  it("creates a pending confirmation for plain task requests instead of creating a task immediately", async () => {
    const { services } = createServices();
    const { connector, sentMessages } = createConnector(services);

    await connector.receiveTextMessage({ chatId: 1, userId: 123, text: "fix the provider pricing UI" });

    expect(services.tasks.createTask).not.toHaveBeenCalled();
    expect(sentMessages.at(-1)?.text).toContain("Reply \"approve task\" to start or \"cancel\".");
  });

  it("approves a pending task confirmation through the existing task path", async () => {
    const { services } = createServices();
    const { connector } = createConnector(services);

    await connector.receiveTextMessage({ chatId: 1, userId: 123, text: "update the README" });
    await connector.receiveTextMessage({ chatId: 1, userId: 123, text: "approve task" });

    expect(services.tasks.createTask).toHaveBeenCalledTimes(1);
    expect(services.tasks.runTask).toHaveBeenCalledWith("task-1");
  });

  it("cancel clears a pending confirmation", async () => {
    const { services } = createServices();
    const { connector, sentMessages } = createConnector(services);

    await connector.receiveTextMessage({ chatId: 1, userId: 123, text: "edit docs" });
    await connector.receiveTextMessage({ chatId: 1, userId: 123, text: "cancel" });
    await connector.receiveTextMessage({ chatId: 1, userId: 123, text: "approve task" });

    expect(sentMessages.at(-2)?.text).toContain("Cancelled the pending task proposal.");
    expect(sentMessages.at(-1)?.text).toContain("There is no pending task confirmation");
    expect(services.tasks.createTask).not.toHaveBeenCalled();
  });

  it("blocks create-task approval during panic mode", async () => {
    const { services } = createServices();
    const { connector, sentMessages } = createConnector(services);

    await connector.receiveTextMessage({ chatId: 1, userId: 123, text: "run the build" });
    await activatePanic("test panic");
    try {
      await connector.receiveTextMessage({ chatId: 1, userId: 123, text: "approve task" });
    } finally {
      await deactivatePanic();
    }

    expect(sentMessages.at(-1)?.text).toContain("Panic mode is active");
    expect(services.tasks.createTask).not.toHaveBeenCalled();
  });

  it("approves a single pending approval without requiring an id", async () => {
    const { services } = createServices({ approvals: [createApproval("approval-1")] });
    const { connector } = createConnector(services);

    await connector.receiveTextMessage({ chatId: 1, userId: 123, text: "approve" });

    expect(services.approvals.resolveApproval).toHaveBeenCalledWith("approval-1", "approved", "once");
  });

  it("asks for an id when multiple approvals are pending", async () => {
    const { services } = createServices({ approvals: [createApproval("approval-1"), createApproval("approval-2")] });
    const { connector, sentMessages } = createConnector(services);

    await connector.receiveTextMessage({ chatId: 1, userId: 123, text: "approve" });

    expect(sentMessages.at(-1)?.text).toContain("Multiple approvals are pending");
    expect(services.approvals.resolveApproval).not.toHaveBeenCalled();
  });

  it("keeps reject available during panic mode", async () => {
    const { services } = createServices({ approvals: [createApproval("approval-1")] });
    const { connector } = createConnector(services);

    await activatePanic("test panic");
    try {
      await connector.receiveTextMessage({ chatId: 1, userId: 123, text: "reject approval-1" });
    } finally {
      await deactivatePanic();
    }

    expect(services.approvals.resolveApproval).toHaveBeenCalledWith("approval-1", "rejected");
  });

  it("restarts heartbeat without forcing the old hardcoded interval", async () => {
    const { services } = createServices();
    const { connector } = createConnector(services);

    await connector.receiveTextMessage({ chatId: 1, userId: 123, text: "/resume confirm" });

    expect(services.heartbeat.start).toHaveBeenCalledWith();
  });

  it("starts heartbeat from Telegram without forcing the old hardcoded interval", async () => {
    const { services } = createServices();
    const { connector } = createConnector(services);

    await connector.receiveTextMessage({ chatId: 1, userId: 123, text: "/heartbeat Feather on" });

    expect(services.heartbeat.start).toHaveBeenCalledWith();
  });

  it("asks for a project when multiple projects exist and no project is mentioned", async () => {
    const { services } = createServices({ projects: [createProject("feather", "Feather"), createProject("other", "Other")] });
    const { connector, sentMessages } = createConnector(services);

    await connector.receiveTextMessage({ chatId: 1, userId: 123, text: "update the README" });

    expect(sentMessages.at(-1)?.text).toContain("I need a project for that task");
    expect(services.tasks.createTask).not.toHaveBeenCalled();
  });

  it("returns a helpful reply for unknown plain messages", async () => {
    const { services } = createServices();
    const { connector, sentMessages } = createConnector(services);

    await connector.receiveTextMessage({ chatId: 1, userId: 123, text: "hello there" });

    expect(sentMessages.at(-1)?.text).toContain("I can help with status");
  });

  it("saves explicit memory through the Telegram command path", async () => {
    const { services } = createServices();
    const { connector, sentMessages } = createConnector(services);

    await connector.receiveTextMessage({ chatId: 1, userId: 123, text: "/save-memory global constraint Do not add features." });

    expect(services.memories.create).toHaveBeenCalledWith({
      scope: "global",
      kind: "constraint",
      content: "Do not add features.",
    });
    expect(sentMessages.at(-1)?.text).toContain("Saved memory");
  });

  it("creates a task with a selected skill through the Telegram command path", async () => {
    const { services } = createServices();
    const { connector, sentMessages } = createConnector(services);

    await connector.receiveTextMessage({ chatId: 1, userId: 123, text: "/use-skill Feather safe-ui-pass clean the dashboard cards" });

    expect(services.tasks.createTask).toHaveBeenCalledWith(expect.objectContaining({
      projectId: "feather",
      skillId: "project:feather:safe-ui-pass",
      prompt: "clean the dashboard cards",
    }));
    expect(sentMessages.at(-1)?.text).toContain("Task created with skill");
  });

  it("lists project skills when the command uses a project name", async () => {
    const { services } = createServices();
    const { connector } = createConnector(services);

    await connector.receiveTextMessage({ chatId: 1, userId: 123, text: "/skills Feather" });

    expect(services.skills.list).toHaveBeenCalledWith({ scope: "project", projectId: "feather" });
  });
});