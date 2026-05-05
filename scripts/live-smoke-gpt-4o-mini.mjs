import fs from "node:fs";
import os from "node:os";
import path from "node:path";

await ensureOpenAIKey();

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "feather-live-smoke-"));
const featherHome = path.join(tempRoot, "home");
const projectRoot = path.join(tempRoot, "project");
const dbPath = path.join(tempRoot, "feather.db");
fs.mkdirSync(featherHome, { recursive: true });
fs.mkdirSync(projectRoot, { recursive: true });

process.env.FEATHER_HOME_DIR = featherHome;

const { closeDb, startDaemon } = await import("../packages/core/dist/index.js");

const daemon = await startDaemon({ port: 0, dbPath });
const address = daemon.app.server.address();
if (!address || typeof address === "string") {
  throw new Error("Could not determine daemon listen address.");
}

const baseUrl = `http://127.0.0.1:${address.port}`;
const smokeFiles = [];
const promptsRun = [];
const results = [];
let cleanupPerformed = false;
let cleanupError = null;
let summaryData = null;

try {
  const providerId = "live-smoke-openai";
  const providerName = "Live Smoke OpenAI";
  const project = await api(baseUrl, "/projects", {
    method: "POST",
    body: JSON.stringify({
      name: "live-smoke",
      rootPath: projectRoot,
    }),
  });

  await api(baseUrl, "/providers", {
    method: "POST",
    body: JSON.stringify({
      id: providerId,
      name: providerName,
      type: "openai",
      enabled: true,
      apiKeyEnv: "OPENAI_API_KEY",
      model: "gpt-4o-mini",
      baseUrl: "https://api.openai.com/v1",
      maxTaskCents: 5,
      inputCentsPer1MTokens: 15,
      outputCentsPer1MTokens: 60,
    }),
  });

  results.push(await runCheck("provider_validation", async () => {
    const response = await api(baseUrl, `/providers/${providerId}/validate`, { method: "POST" });
    if (!response.health?.ok) {
      throw new Error(response.health?.message ?? "Provider validation failed.");
    }
    return response.health.message;
  }));

  results.push(await runCheck("text_only_task", async () => {
    const prompt = "Reply with exactly: FEATHER_SMOKE_TEXT_OK";
    promptsRun.push(prompt);
    const task = await createTask(baseUrl, {
      projectId: project.project.id,
      providerId,
      title: "smoke text",
      prompt,
    });
    await waitForTaskCompletion(baseUrl, task.task.id);
    const events = await getTaskEvents(baseUrl, task.task.id);
    const text = extractTaskText(events).trim();
    if (text !== "FEATHER_SMOKE_TEXT_OK") {
      throw new Error(`Unexpected text output: ${text || "<empty>"}`);
    }
    return text;
  }));

  results.push(await runCheck("tool_write_approve", async () => {
    const prompt = "Create a file named docs/smoke-ok.txt containing exactly FEATHER_TOOL_WRITE_OK. Use Feather tool protocol if you need to write.";
    promptsRun.push(prompt);
    const task = await createTask(baseUrl, {
      projectId: project.project.id,
      providerId,
      title: "smoke write approve",
      prompt,
    });
    const approval = await waitForPendingApproval(baseUrl, task.task.id);
    const smokePath = path.join(projectRoot, "docs", "smoke-ok.txt");
    if (fs.existsSync(smokePath)) {
      throw new Error("docs/smoke-ok.txt existed before approval.");
    }
    await api(baseUrl, `/approvals/${approval.id}/resolve`, {
      method: "POST",
      body: JSON.stringify({ decision: "approved", scope: "once" }),
    });
    const finalTask = await waitForTaskCompletion(baseUrl, task.task.id);
    if (finalTask.status !== "completed") {
      throw new Error(`Task finished with status ${finalTask.status}.`);
    }
    if (!fs.existsSync(smokePath)) {
      throw new Error("docs/smoke-ok.txt was not created after approval.");
    }
    const content = fs.readFileSync(smokePath, "utf8").trim();
    if (content !== "FEATHER_TOOL_WRITE_OK") {
      throw new Error(`Unexpected file content: ${content}`);
    }
    const events = await getTaskEvents(baseUrl, task.task.id);
    if (!events.some((event) => event.type === "diff" && event.path === "docs/smoke-ok.txt")) {
      throw new Error("No diff event recorded for docs/smoke-ok.txt.");
    }
    smokeFiles.push("docs/smoke-ok.txt");
    return content;
  }));

  results.push(await runCheck("tool_write_reject", async () => {
    const prompt = "Create a file named docs/smoke-reject.txt containing exactly SHOULD_NOT_EXIST. Use Feather tool protocol if you need to write.";
    promptsRun.push(prompt);
    const task = await createTask(baseUrl, {
      projectId: project.project.id,
      providerId,
      title: "smoke write reject",
      prompt,
    });
    const approval = await waitForPendingApproval(baseUrl, task.task.id);
    await api(baseUrl, `/approvals/${approval.id}/resolve`, {
      method: "POST",
      body: JSON.stringify({ decision: "rejected" }),
    });
    const finalTask = await waitForTaskCompletion(baseUrl, task.task.id);
    if (fs.existsSync(path.join(projectRoot, "docs", "smoke-reject.txt"))) {
      throw new Error("docs/smoke-reject.txt exists after rejection.");
    }
    const events = await getTaskEvents(baseUrl, task.task.id);
    if (!events.some((event) => event.type === "approval_resolved" && event.decision === "rejected")) {
      throw new Error("Task events did not record the rejection.");
    }
    return finalTask.status;
  }));

  results.push(await runCheck("cancellation", async () => {
    const prompt = "Output FEATHER_CANCEL_SHOULD_NOT_FINISH on 1200 separate lines and nothing else.";
    promptsRun.push(prompt);
    const task = await createTask(baseUrl, {
      projectId: project.project.id,
      providerId,
      title: "smoke cancel",
      prompt,
    });
    await api(baseUrl, `/tasks/${task.task.id}`, { method: "DELETE" });
    const finalTask = await waitForTaskCompletion(baseUrl, task.task.id, { allowStatuses: ["cancelled", "completed", "failed", "blocked"] });
    if (finalTask.status !== "cancelled") {
      throw new Error(`Expected cancelled status, got ${finalTask.status}.`);
    }
    return finalTask.status;
  }));

  results.push(await runCheck("budget_estimation", async () => {
    const prompt = "Reply with exactly FEATHER_BUDGET_OK.";
    promptsRun.push(prompt);
    const task = await createTask(baseUrl, {
      projectId: project.project.id,
      providerId,
      title: "smoke budget",
      prompt,
      budgetCents: 2,
    });
    await waitForTaskCompletion(baseUrl, task.task.id);
    const events = await getTaskEvents(baseUrl, task.task.id);
    const costEvents = events
      .filter((event) => event.type === "provider_event" && event.event?.type === "cost_estimate")
      .map((event) => event.event);
    if (costEvents.length === 0) {
      throw new Error("No cost_estimate event recorded for the budget smoke.");
    }
    const dailySpend = await api(baseUrl, `/budgets/daily-spend?projectId=${encodeURIComponent(project.project.id)}`);
    if ((dailySpend.dailySpendCents ?? 0) <= 0) {
      throw new Error("Daily spend did not increase after a priced task.");
    }
    return `${costEvents.length} cost event(s), daily spend ${dailySpend.dailySpendCents} cents`;
  }));

  results.push(await runCheck("panic_resume", async () => {
    await api(baseUrl, "/panic", { method: "POST" });
    let blocked = false;
    try {
      await createTask(baseUrl, {
        projectId: project.project.id,
        providerId,
        title: "panic blocked",
        prompt: "Reply with exactly PANIC_SHOULD_BLOCK.",
      });
    } catch {
      blocked = true;
    }
    if (!blocked) {
      throw new Error("Task creation was not blocked during panic mode.");
    }
    await api(baseUrl, "/resume", { method: "POST" });
    const prompt = "Reply with exactly FEATHER_PANIC_RESUME_OK";
    promptsRun.push(prompt);
    const task = await createTask(baseUrl, {
      projectId: project.project.id,
      providerId,
      title: "panic resume",
      prompt,
    });
    await waitForTaskCompletion(baseUrl, task.task.id);
    return "panic blocked and resume recovered";
  }));

  results.push(await runCheck("auto_route", async () => {
    await api(baseUrl, `/projects/${project.project.id}`, {
      method: "PATCH",
      body: JSON.stringify({ defaultProviderId: providerId, codingProviderId: providerId }),
    });
    const prompt = "Reply with exactly FEATHER_AUTO_ROUTE_OK";
    promptsRun.push(prompt);
    const task = await createTask(baseUrl, {
      projectId: project.project.id,
      title: "auto route",
      prompt,
    });
    const finalTask = await waitForTaskCompletion(baseUrl, task.task.id);
    if (finalTask.providerId !== providerId) {
      throw new Error(`Expected auto-routed provider ${providerId}, got ${finalTask.providerId}.`);
    }
    return finalTask.providerId;
  }));

  const passed = results.filter((result) => result.ok).length;
  const failed = results.length - passed;
  const tokenSummary = await summarizeTokens(baseUrl, project.project.id);

  summaryData = {
    model: "gpt-4o-mini",
    promptsRun: promptsRun.length,
    tempProjectFilesCreated: smokeFiles,
    results,
    tokenSummary,
  };

  if (failed > 0) {
    process.exitCode = 1;
  }
} finally {
  daemon.telegram?.stop?.();
  daemon.heartbeat.stop();
  await daemon.app.close();
  closeDb();
  try {
    fs.rmSync(tempRoot, { recursive: true, force: true });
    cleanupPerformed = true;
  } catch (error) {
    cleanupError = error instanceof Error ? error.message : String(error);
    process.exitCode = 1;
  }

  console.log("LIVE_SMOKE_SUMMARY");
  console.log(JSON.stringify({
    ...(summaryData ?? {
      model: "gpt-4o-mini",
      promptsRun: promptsRun.length,
      tempProjectFilesCreated: smokeFiles,
      results,
    }),
    cleanupPerformed,
    ...(cleanupError ? { cleanupError } : {}),
  }, null, 2));
}

async function ensureOpenAIKey() {
  if (process.env.OPENAI_API_KEY) {
    return;
  }
  const envPath = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) {
    throw new Error("OPENAI_API_KEY is not set and .env.local was not found.");
  }
  const raw = fs.readFileSync(envPath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const match = trimmed.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match) {
      continue;
    }
    const [, key, value] = match;
    if (key === "OPENAI_API_KEY") {
      process.env.OPENAI_API_KEY = value.replace(/^['\"]|['\"]$/g, "");
      return;
    }
  }
  throw new Error("OPENAI_API_KEY was not found in .env.local.");
}

async function api(baseUrl, requestPath, options = {}) {
  const hasBody = options.body !== undefined;
  const response = await fetch(`${baseUrl}${requestPath}`, {
    ...options,
    headers: {
      ...(hasBody ? { "Content-Type": "application/json" } : {}),
      ...(options.headers ?? {}),
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${response.status} ${response.statusText}: ${text}`);
  }

  return response.json();
}

async function createTask(baseUrl, body) {
  return api(baseUrl, "/tasks", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

async function waitForTaskCompletion(baseUrl, taskId, options = {}) {
  const allowStatuses = options.allowStatuses ?? ["completed", "blocked", "failed", "cancelled"];
  const timeoutMs = options.timeoutMs ?? 120000;
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const response = await api(baseUrl, `/tasks/${taskId}`);
    if (allowStatuses.includes(response.task.status)) {
      return response.task;
    }
    await sleep(400);
  }
  throw new Error(`Timed out waiting for task ${taskId}.`);
}

async function waitForPendingApproval(baseUrl, taskId, timeoutMs = 120000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const response = await api(baseUrl, "/approvals");
    const approval = response.approvals.find((entry) => entry.taskId === taskId && entry.status === "pending");
    if (approval) {
      return approval;
    }
    const task = await api(baseUrl, `/tasks/${taskId}`);
    if (["failed", "blocked", "cancelled", "completed"].includes(task.task.status)) {
      throw new Error(`Task ${taskId} reached ${task.task.status} before producing an approval.`);
    }
    await sleep(400);
  }
  throw new Error(`Timed out waiting for approval on task ${taskId}.`);
}

async function getTaskEvents(baseUrl, taskId) {
  const response = await api(baseUrl, `/tasks/${taskId}/events`);
  return response.events;
}

function extractTaskText(events) {
  const providerText = events
    .filter((event) => event.type === "provider_event" && event.event?.type === "text_delta")
    .map((event) => event.event.text ?? "")
    .join("");
  if (providerText.trim()) {
    return providerText;
  }
  const summary = events.findLast((event) => event.type === "summary");
  return summary?.content ?? "";
}

async function summarizeTokens(baseUrl, projectId) {
  const tasksResponse = await api(baseUrl, `/tasks?projectId=${encodeURIComponent(projectId)}`);
  let inputTokens = 0;
  let outputTokens = 0;
  for (const task of tasksResponse.tasks) {
    const events = await getTaskEvents(baseUrl, task.id);
    for (const event of events) {
      if (event.type === "provider_event" && event.event?.type === "cost_estimate") {
        inputTokens += event.event.inputTokens ?? 0;
        outputTokens += event.event.outputTokens ?? 0;
      }
    }
  }
  return { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens };
}

async function runCheck(name, fn) {
  try {
    const detail = await fn();
    return { name, ok: true, detail };
  } catch (error) {
    return { name, ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
