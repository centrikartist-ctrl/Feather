import path from "node:path";
import os from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Approval, Observation, Project, Task } from "@feather/shared";
import { closeDb, initDb } from "../db/index.js";
import { _resetPanicForTesting, activatePanic, deactivatePanic } from "../panic/index.js";
import { TelegramConnector, buildTelegramSendPayload, classifyTelegramFreeformIntent } from "./index.js";

function createProject(id: string, name = id, rootPath = `C:\\Projects\\${id}`): Project {
  return {
    id,
    name,
    rootPath,
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

function createTask(id: string, title = id, status: Task["status"] = "queued"): Task {
  return {
    id,
    title,
    prompt: title,
    status,
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

function createProvider(id: string, overrides: Partial<Record<string, unknown>> = {}) {
  const provider = {
    id,
    name: (overrides.name as string | undefined) ?? id,
    type: (overrides.type as string | undefined) ?? "openai",
    capabilities: {
      streaming: true,
      toolCalling: false,
      coding: true,
      reasoning: false,
      costEstimate: false,
      supportsProjectRoot: false,
      costEnforcementMode: "unknown",
    },
    validateConfig: vi.fn(async () => ({ ok: true, message: "ok" })),
    startTask: async function* () {
      return;
    },
    cancelTask: vi.fn(async () => undefined),
    ...(overrides.startChat ? { startChat: overrides.startChat } : {}),
  };

  return Object.assign(provider, overrides);
}

function createServices(options: {
  projects?: Project[];
  approvals?: Approval[];
  tasks?: Task[];
  observations?: Observation[];
  providers?: Array<ReturnType<typeof createProvider>>;
} = {}) {
  const state = {
    projects: options.projects ?? [createProject("feather", "Feather")],
    approvals: options.approvals ?? [],
    tasks: options.tasks ?? [],
    observations: options.observations ?? [createObservation("Docs are stale")],
    providers: options.providers ?? [createProvider("provider-1")],
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
      list: vi.fn(() => state.providers),
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
      list: vi.fn(async () => [{ id: "project:feather:safe-ui-pass", name: "Safe UI Pass", scope: "project", projectId: "feather", path: "C:\\skills\\safe-ui-pass.md", purpose: "", allowedTools: ["filesystem.readFile"], instructions: "Preserve routing." }]),
    },
  };

  return { services, state };
}

function createConnector(
  overrides: ReturnType<typeof createServices>["services"],
  configOverrides: Partial<ConstructorParameters<typeof TelegramConnector>[0]> = {},
) {
  const sentMessages: Array<{ chatId: number; text: string }> = [];
  const connector = new TelegramConnector(
    {
      botToken: "test-token",
      allowedUserIds: [123, 456],
      allowSingleProviderAutoRoute: true,
      ...configOverrides,
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

describe("TelegramConnector", () => {
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
    const connector = new TelegramConnector({ botToken: "test-token", allowedUserIds: [123, 456] }, services as never);

    expect(connector.isAllowedUser(123)).toBe(true);
    expect(connector.isAllowedUser(999)).toBe(false);
    expect(connector.isAllowedUser(undefined)).toBe(false);
  });

  it("allows only safe commands during panic mode", () => {
    const { services } = createServices();
    const connector = new TelegramConnector({ botToken: "test-token", allowedUserIds: [123, 456] }, services as never);

    expect((connector as never as { isAllowedDuringPanic: (cmd: string, args: string[]) => boolean }).isAllowedDuringPanic("/status", [])).toBe(true);
    expect((connector as never as { isAllowedDuringPanic: (cmd: string, args: string[]) => boolean }).isAllowedDuringPanic("/task", ["proj", "do", "work"])).toBe(false);
    expect((connector as never as { isAllowedDuringPanic: (cmd: string, args: string[]) => boolean }).isAllowedDuringPanic("/approve", ["abc"])).toBe(false);
    expect((connector as never as { isAllowedDuringPanic: (cmd: string, args: string[]) => boolean }).isAllowedDuringPanic("/reject", ["abc"])).toBe(true);
    expect((connector as never as { isAllowedDuringPanic: (cmd: string, args: string[]) => boolean }).isAllowedDuringPanic("/clear-chat", [])).toBe(true);
  });

  it("builds plain text Telegram payloads without markdown parse mode", () => {
    expect(buildTelegramSendPayload(123, "hello")).toEqual({ chat_id: 123, text: "hello" });
    expect(buildTelegramSendPayload(123, "hello")).not.toHaveProperty("parse_mode");
  });

  it("classifies show projects as read-only and hello as conversation", () => {
    expect(classifyTelegramFreeformIntent("show projects", { projects: [createProject("feather", "Feather")], pendingApprovals: [] })).toEqual({
      type: "read_only_question",
      question: "show projects",
      projectId: undefined,
      topic: "projects",
    });

    expect(classifyTelegramFreeformIntent("hello", { projects: [createProject("feather", "Feather")], pendingApprovals: [] })).toEqual({
      type: "conversation",
      message: "hello",
    });
  });

  it("keeps slash command discovery working", async () => {
    const { services } = createServices();
    const { connector, sentMessages } = createConnector(services);

    await connector.receiveTextMessage({ chatId: 1, userId: 123, text: "/help" });
    await connector.receiveTextMessage({ chatId: 1, userId: 123, text: "/actions" });
    await connector.receiveTextMessage({ chatId: 1, userId: 123, text: "/examples" });

    expect(sentMessages[0]?.text).toContain("/clear-chat");
    expect(sentMessages[1]?.text).toContain("plain conversation -> task proposal -> approve task");
    expect(sentMessages[2]?.text).toContain("help me plan a docs polish pass");
  });

  it("returns status for plain status requests", async () => {
    const { services } = createServices({ tasks: [createTask("task-1", "Fix docs")], approvals: [createApproval("approval-1")] });
    const { connector, sentMessages } = createConnector(services);

    await connector.receiveTextMessage({ chatId: 1, userId: 123, text: "what's going on with Feather?" });

    expect(sentMessages.at(-1)?.text).toContain("Pending approvals: 1");
    expect(sentMessages.at(-1)?.text).toContain("Project: Feather");
  });

  it("always replies to /projects with Windows paths safely", async () => {
    const { services } = createServices({
      projects: [createProject("feather", "Feather", "C:\\Users\\ciara\\OneDrive\\Desktop\\Projects\\Feather")],
    });
    const { connector, sentMessages } = createConnector(services);

    await connector.receiveTextMessage({ chatId: 1, userId: 123, text: "/projects" });

    expect(sentMessages.at(-1)?.text).toContain("C:\\Users\\ciara\\OneDrive\\Desktop\\Projects\\Feather");
  });

  it("answers show projects through the local state layer", async () => {
    const { services } = createServices();
    const { connector, sentMessages } = createConnector(services);

    await connector.receiveTextMessage({ chatId: 1, userId: 123, text: "show projects" });

    expect(sentMessages.at(-1)?.text).toContain("Feather");
  });

  it("returns a natural local conversational reply for hello", async () => {
    const { services } = createServices({ providers: [] });
    const { connector, sentMessages } = createConnector(services);

    await connector.receiveTextMessage({ chatId: 1, userId: 123, text: "hello" });

    expect(sentMessages.at(-1)?.text).toContain("I can help you think through plans");
  });

  it("returns a natural local reply for what can you do when no provider is configured", async () => {
    const { services } = createServices({ providers: [] });
    const { connector, sentMessages } = createConnector(services);

    await connector.receiveTextMessage({ chatId: 1, userId: 123, text: "what can you do?" });

    expect(sentMessages.at(-1)?.text).toContain("I can answer local status questions");
    expect(sentMessages.at(-1)?.text).toContain("richer provider-backed chat needs a configured provider");
  });

  it("calls a configured chat provider in chat-only mode without creating tasks", async () => {
    const startChat = vi.fn(async (_input: { maxOutputTokens?: number; messages: Array<{ role: string; content: string }> }) => ({ text: "Provider chat reply" }));
    const { services } = createServices({
      providers: [createProvider("chat-provider", { name: "Chat Provider", startChat })],
    });
    const { connector, sentMessages } = createConnector(services, { chat: { providerId: "chat-provider", maxContextMessages: 12, maxOutputTokens: 700 } });

    await connector.receiveTextMessage({ chatId: 1, userId: 123, text: "help me think through Feather" });

    expect(startChat).toHaveBeenCalledTimes(1);
    const firstCall = startChat.mock.calls[0]?.[0];
    expect(firstCall).toEqual(expect.objectContaining({
      maxOutputTokens: 700,
      messages: expect.arrayContaining([{ role: "user", content: "help me think through Feather" }]),
    }));
    expect(services.tasks.createTask).not.toHaveBeenCalled();
    expect(sentMessages.at(-1)?.text).toBe("Provider chat reply");
  });

  it("creates a pending confirmation for action requests when one project exists", async () => {
    const { services } = createServices();
    const { connector, sentMessages } = createConnector(services);

    await connector.receiveTextMessage({ chatId: 1, userId: 123, text: "create a small note in docs saying Telegram alpha test worked" });

    expect(services.tasks.createTask).not.toHaveBeenCalled();
    expect(sentMessages.at(-1)?.text).toContain("I can create this as a task.");
    expect(sentMessages.at(-1)?.text).toContain("Reply approve task or edit: <new instruction> or cancel.");
  });

  it("asks for a project when multiple projects exist and no project is mentioned", async () => {
    const { services } = createServices({ projects: [createProject("feather", "Feather"), createProject("other", "Other")] });
    const { connector, sentMessages } = createConnector(services);

    await connector.receiveTextMessage({ chatId: 1, userId: 123, text: "update the README" });

    expect(sentMessages.at(-1)?.text).toContain("Which project should I use?");
    expect(services.tasks.createTask).not.toHaveBeenCalled();
  });

  it("lets the user disambiguate the project after an action request", async () => {
    const { services } = createServices({ projects: [createProject("feather", "Feather"), createProject("other", "Other")] });
    const { connector, sentMessages } = createConnector(services);

    await connector.receiveTextMessage({ chatId: 1, userId: 123, text: "update the README" });
    await connector.receiveTextMessage({ chatId: 1, userId: 123, text: "Feather" });

    expect(sentMessages.at(-1)?.text).toContain("Project: Feather");
    expect(sentMessages.at(-1)?.text).toContain("Reply approve task or edit: <new instruction> or cancel.");
  });

  it("turns recent conversation into a task proposal when the user says do it", async () => {
    const { services } = createServices();
    const { connector, sentMessages } = createConnector(services);

    await connector.receiveTextMessage({ chatId: 1, userId: 123, text: "help me plan a docs polish pass" });
    await connector.receiveTextMessage({ chatId: 1, userId: 123, text: "do it" });

    expect(sentMessages.at(-1)?.text).toContain("Source: recent Telegram conversation");
    expect(sentMessages.at(-1)?.text).toContain("Reply approve task or edit: <new instruction> or cancel.");
  });

  it("approve task only creates a task when a pending proposal exists", async () => {
    const { services } = createServices();
    const { connector, sentMessages } = createConnector(services);

    await connector.receiveTextMessage({ chatId: 1, userId: 123, text: "approve task" });
    expect(sentMessages.at(-1)?.text).toContain("There is no pending task confirmation");

    await connector.receiveTextMessage({ chatId: 1, userId: 123, text: "update the README" });
    await connector.receiveTextMessage({ chatId: 1, userId: 123, text: "approve task" });

    expect(services.tasks.createTask).toHaveBeenCalledTimes(1);
    expect(services.tasks.runTask).toHaveBeenCalledWith("task-1");
  });

  it("cancel clears pending confirmation state", async () => {
    const { services } = createServices();
    const { connector, sentMessages } = createConnector(services);

    await connector.receiveTextMessage({ chatId: 1, userId: 123, text: "edit docs" });
    await connector.receiveTextMessage({ chatId: 1, userId: 123, text: "cancel" });
    await connector.receiveTextMessage({ chatId: 1, userId: 123, text: "approve task" });

    expect(sentMessages.at(-2)?.text).toContain("Cancelled the pending task proposal.");
    expect(sentMessages.at(-1)?.text).toContain("There is no pending task confirmation");
    expect(services.tasks.createTask).not.toHaveBeenCalled();
  });

  it("allows editing the pending proposal", async () => {
    const { services } = createServices();
    const { connector, sentMessages } = createConnector(services);

    await connector.receiveTextMessage({ chatId: 1, userId: 123, text: "update the README" });
    await connector.receiveTextMessage({ chatId: 1, userId: 123, text: "edit: make it docs only, no code" });

    expect(sentMessages.at(-1)?.text).toContain("make it docs only, no code");
  });

  it("keeps reject available during panic mode but blocks task proposals and approvals", async () => {
    const { services } = createServices({ approvals: [createApproval("approval-1")] });
    const { connector, sentMessages } = createConnector(services);

    await activatePanic("test panic");
    try {
      await connector.receiveTextMessage({ chatId: 1, userId: 123, text: "help me plan a task for later" });
      await connector.receiveTextMessage({ chatId: 1, userId: 123, text: "update the README" });
      await connector.receiveTextMessage({ chatId: 1, userId: 123, text: "approve task" });
      await connector.receiveTextMessage({ chatId: 1, userId: 123, text: "reject approval-1" });
    } finally {
      await deactivatePanic();
    }

    expect(sentMessages[0]?.text).toContain("cannot create or approve work until panic is resumed");
    expect(sentMessages[1]?.text).toContain("cannot create or approve work until panic is resumed");
    expect(sentMessages[2]?.text).toContain("There is no pending task confirmation");
    expect(services.approvals.resolveApproval).toHaveBeenCalledWith("approval-1", "rejected");
  });

  it("restarts heartbeat without forcing the old hardcoded interval", async () => {
    const { services } = createServices();
    const { connector } = createConnector(services);

    await connector.receiveTextMessage({ chatId: 1, userId: 123, text: "/resume confirm" });

    expect(services.heartbeat.start).toHaveBeenCalledWith();
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

  it("clears the in-memory chat session with /clear-chat", async () => {
    const { services } = createServices();
    const { connector, sentMessages } = createConnector(services);

    await connector.receiveTextMessage({ chatId: 1, userId: 123, text: "help me plan a docs polish pass" });
    await connector.receiveTextMessage({ chatId: 1, userId: 123, text: "/clear-chat" });
    await connector.receiveTextMessage({ chatId: 1, userId: 123, text: "do it" });

    expect(sentMessages.at(-2)?.text).toContain("Cleared the Telegram chat session");
    expect(sentMessages.at(-1)?.text).toContain("I do not have enough recent conversation");
  });
});