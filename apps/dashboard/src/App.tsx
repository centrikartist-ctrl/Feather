import React from "react";
import { Routes, Route, NavLink, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Home,
  FolderOpen,
  Terminal,
  CheckSquare,
  Heart,
  Brain,
  Layers3,
  Cpu,
  DollarSign,
  ScrollText,
  Settings,
  AlertTriangle,
  Zap,
} from "lucide-react";
import clsx from "clsx";
import { api, type AgentProfileRequest, type MachineSetupRequest, type OnboardingState } from "./api.js";
import {
  applyProviderTypeDefaults,
  createDefaultProviderForm,
  getProviderCredentialSummary,
  getProviderModelOptions,
  isCustomProviderModel,
  isProviderFormValid,
  providerToForm,
  serializeProviderForm,
  type ProviderFormState,
} from "./provider-form.js";

const FEATHER_VERSION = "v0.1.0-alpha";

// ── Navigation ───────────────────────────────────────────────────────────────
const NAV = [
  { to: "/", label: "Home", icon: Home, exact: true },
  { to: "/projects", label: "Projects", icon: FolderOpen },
  { to: "/tasks", label: "Tasks", icon: Terminal },
  { to: "/approvals", label: "Approvals", icon: CheckSquare },
  { to: "/heartbeat", label: "Heartbeat", icon: Heart },
  { to: "/memory", label: "Memory", icon: Brain },
  { to: "/skills", label: "Skills", icon: Layers3 },
  { to: "/providers", label: "Providers", icon: Cpu },
  { to: "/budgets", label: "Budgets", icon: DollarSign },
  { to: "/logs", label: "Logs", icon: ScrollText },
  { to: "/settings", label: "Settings", icon: Settings },
];

type MemoryKind = import("@feather/shared").MemoryKind;

type SkillFormState = {
  scope: "global" | "project";
  projectId: string;
  id: string;
  name: string;
  purpose: string;
  allowedTools: string;
  instructions: string;
  output: string;
};

function createDefaultSkillForm(): SkillFormState {
  return {
    scope: "global",
    projectId: "",
    id: "",
    name: "",
    purpose: "",
    allowedTools: "filesystem.readFile",
    instructions: "",
    output: "",
  };
}

function Sidebar() {
  const { data: health } = useQuery({ queryKey: ["health"], queryFn: api.health, refetchInterval: 5000 });
  const qc = useQueryClient();
  const panicMut = useMutation({
    mutationFn: api.panic,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["health"] }),
  });

  return (
    <aside className="w-56 shrink-0 bg-slate-900 border-r border-slate-800 flex flex-col h-screen">
      <div className="p-4 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <span className="text-feather-500 text-xl">🪶</span>
          <span className="font-bold text-white">Feather</span>
          <span className="text-xs text-slate-500 ml-auto">{FEATHER_VERSION}</span>
        </div>
        {health && (
          <div className={clsx("text-xs mt-1", health.panic?.active ? "text-red-400" : "text-emerald-400")}>
            {health.panic?.active ? "⚠ PANIC MODE" : "● Running"}
          </div>
        )}
      </div>

      <nav className="flex-1 p-2 space-y-0.5">
        {NAV.map(({ to, label, icon: Icon, exact }) => (
          <NavLink
            key={to}
            to={to}
            end={exact}
            className={({ isActive }) =>
              clsx(
                "flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors",
                isActive
                  ? "bg-feather-600 text-white"
                  : "text-slate-400 hover:text-white hover:bg-slate-800",
              )
            }
          >
            <Icon size={16} />
            {label}
          </NavLink>
        ))}
      </nav>

      <div className="p-3 border-t border-slate-800">
        <button
          onClick={() => panicMut.mutate()}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-md text-sm bg-red-900/50 hover:bg-red-800 text-red-300 hover:text-white transition-colors"
        >
          <Zap size={14} />
          Panic
        </button>
      </div>
    </aside>
  );
}

// ── Pages ────────────────────────────────────────────────────────────────────
function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={clsx("bg-slate-800 border border-slate-700 rounded-lg p-4", className)}>
      {children}
    </div>
  );
}

function Badge({ children, variant = "default" }: { children: React.ReactNode; variant?: "default" | "warning" | "danger" | "success" | "info" }) {
  return (
    <span className={clsx("inline-flex items-center px-2 py-0.5 rounded text-xs font-medium", {
      "bg-slate-700 text-slate-300": variant === "default",
      "bg-yellow-900/50 text-yellow-300": variant === "warning",
      "bg-red-900/50 text-red-300": variant === "danger",
      "bg-emerald-900/50 text-emerald-300": variant === "success",
      "bg-blue-900/50 text-blue-300": variant === "info",
    })}>
      {children}
    </span>
  );
}

const APPROVAL_PAYLOAD_PREVIEW_LIMIT = 4000;

function formatCostMode(mode: "known" | "estimated" | "unknown" | undefined): "known" | "estimated" | "unknown" {
  return mode ?? "unknown";
}

function getBudgetEnforcementLabel(mode: "known" | "estimated" | "unknown" | undefined): string {
  switch (formatCostMode(mode)) {
    case "known":
      return "Budget enforcement: known provider cost data";
    case "estimated":
      return "Budget enforcement: estimated from configured pricing";
    default:
      return "Budget enforcement: usage-only / unknown pricing";
  }
}

function ApprovalPayloadPreview({ payload }: { payload: unknown }) {
  const [showFull, setShowFull] = React.useState(false);
  const pretty = JSON.stringify(payload, null, 2);
  const truncated = pretty.length > APPROVAL_PAYLOAD_PREVIEW_LIMIT;
  const visiblePayload = showFull || !truncated
    ? pretty
    : `${pretty.slice(0, APPROVAL_PAYLOAD_PREVIEW_LIMIT)}\n... truncated in dashboard preview ...`;

  return (
    <details className="mt-2">
      <summary className="cursor-pointer text-xs text-slate-500">Approval payload preview</summary>
      <pre className="mt-1 max-h-96 overflow-auto rounded bg-slate-900 p-2 text-xs text-slate-400">
        {visiblePayload}
      </pre>
      <div className="mt-2 flex items-center justify-between gap-3 text-xs text-slate-500">
        <span>Large diffs are truncated here. Feather {FEATHER_VERSION} still uses simple full-replace diff previews.</span>
        {truncated && (
          <button
            type="button"
            onClick={() => setShowFull((current) => !current)}
            className="text-slate-300 transition-colors hover:text-white"
          >
            {showFull ? "Show truncated preview" : "Show full payload"}
          </button>
        )}
      </div>
    </details>
  );
}

function HomePage() {
  const { data: health } = useQuery({ queryKey: ["health"], queryFn: api.health, refetchInterval: 5000 });
  const { data: approvalData } = useQuery({ queryKey: ["approvals"], queryFn: () => api.approvals.list(), refetchInterval: 10000 });
  const { data: obsData } = useQuery({ queryKey: ["observations"], queryFn: () => api.heartbeat.observations() });
  const { data: taskData } = useQuery({ queryKey: ["tasks"], queryFn: () => api.tasks.list() });
  const { data: providerData } = useQuery({ queryKey: ["providers"], queryFn: api.providers.list });
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [quickPrompt, setQuickPrompt] = React.useState("");
  const [selectedProject, setSelectedProject] = React.useState("");
  const [selectedProvider, setSelectedProvider] = React.useState("");
  const [selectedSkill, setSelectedSkill] = React.useState("");
  const { data: projectData } = useQuery({ queryKey: ["projects"], queryFn: api.projects.list });
  const { data: skillData } = useQuery({ queryKey: ["skills"], queryFn: () => api.skills.list() });

  const createTask = useMutation({
    mutationFn: api.tasks.create,
    onSuccess: (data) => {
      void qc.invalidateQueries({ queryKey: ["tasks"] });
      setQuickPrompt("");
      navigate(`/tasks/${data.task.id}`);
    },
  });

  const activeTasks = taskData?.tasks.filter((t) => t.status === "running" || t.status === "queued") ?? [];
  const pendingApprovals = approvalData?.approvals ?? [];

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold text-white">Dashboard</h1>

      <div className="grid grid-cols-3 gap-4">
        <Card>
          <div className="text-slate-400 text-sm mb-1">Daemon</div>
          <div className={clsx("font-semibold", health ? "text-emerald-400" : "text-red-400")}>
            {health ? (health.panic?.active ? "⚠ Panic Mode" : "Running") : "Unreachable"}
          </div>
        </Card>
        <Card>
          <div className="text-slate-400 text-sm mb-1">Active Tasks</div>
          <div className="font-semibold text-white">{activeTasks.length}</div>
        </Card>
        <Card>
          <div className="text-slate-400 text-sm mb-1">Pending Approvals</div>
          <div className={clsx("font-semibold", pendingApprovals.length > 0 ? "text-yellow-400" : "text-white")}>
            {pendingApprovals.length}
          </div>
        </Card>
      </div>

      <Card>
        <h2 className="text-sm font-semibold text-slate-300 mb-3">Quick Task</h2>
        <div className="flex gap-2">
          <select
            value={selectedProject}
            onChange={(e) => setSelectedProject(e.target.value)}
            className="bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm text-white"
          >
            <option value="">No project</option>
            {projectData?.projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <input
            className="flex-1 bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-feather-500"
            placeholder="Describe a task..."
            value={quickPrompt}
            onChange={(e) => setQuickPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && quickPrompt.trim()) {
                createTask.mutate({
                  projectId: selectedProject || undefined,
                  skillId: selectedSkill || undefined,
                  title: quickPrompt.slice(0, 80),
                  prompt: quickPrompt,
                  providerId: selectedProvider || undefined,
                });
              }
            }}
          />
          <select
            value={selectedProvider}
            onChange={(e) => setSelectedProvider(e.target.value)}
            className="bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm text-white"
          >
            <option value="">Auto route</option>
            {providerData?.providers.map((provider) => (
              <option key={provider.id} value={provider.id}>{provider.name}</option>
            ))}
          </select>
          <select
            value={selectedSkill}
            onChange={(e) => setSelectedSkill(e.target.value)}
            className="bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm text-white"
          >
            <option value="">No skill</option>
            {skillData?.skills.map((skill) => (
              <option key={skill.id} value={skill.id}>{skill.name}</option>
            ))}
          </select>
          <button
            disabled={!quickPrompt.trim() || createTask.isPending}
            onClick={() => createTask.mutate({ projectId: selectedProject || undefined, skillId: selectedSkill || undefined, title: quickPrompt.slice(0, 80), prompt: quickPrompt, providerId: selectedProvider || undefined })}
            className="px-4 py-2 bg-feather-600 hover:bg-feather-500 disabled:opacity-50 text-white text-sm rounded transition-colors"
          >
            Send
          </button>
        </div>
        {selectedSkill && (
          <div className="mt-3 text-xs text-slate-400">
            Using skill: {skillData?.skills.find((skill) => skill.id === selectedSkill)?.name ?? selectedSkill}. Skills narrow behavior but do not bypass approvals or permissions.
          </div>
        )}
      </Card>

      <Card>
        <div className="flex items-start justify-between gap-6">
          <div className="space-y-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-300">How To Use Feather</h2>
              <p className="mt-2 max-w-3xl text-sm text-slate-400">
                Feather works best as a supervised loop: add a provider, register a project, create a small task,
                review risky writes or commands before approving them, and use panic if anything feels wrong.
              </p>
            </div>
            <ol className="grid gap-2 text-sm text-slate-300 md:grid-cols-2">
              <li>1. Add a provider</li>
              <li>2. Add a project</li>
              <li>3. Create a small task</li>
              <li>4. Review approvals before risky writes or commands</li>
              <li>5. Use panic if anything feels wrong</li>
              <li>6. Optional: connect Telegram</li>
              <li>7. Optional: add memories</li>
              <li>8. Optional: create or use skills</li>
              <li>9. Guard starts with pnpm dev; manual supervisor commands stay available</li>
            </ol>
          </div>
          <div className="min-w-[260px] rounded-lg border border-slate-700 bg-slate-900/70 p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Useful commands</div>
            <div className="mt-3 space-y-2 text-sm text-slate-300">
              <div><code className="text-slate-100">pnpm dev</code></div>
              <div><code className="text-slate-100">pnpm run setup</code></div>
              <div><code className="text-slate-100">pnpm --filter @feather/cli exec tsx src/main.ts commands</code></div>
              <div><code className="text-slate-100">pnpm --filter @feather/cli exec tsx src/main.ts doctor</code></div>
              <div><code className="text-slate-100">pnpm --filter @feather/supervisor exec tsx src/main.ts status</code></div>
              <div><code className="text-slate-100">/help</code>, <code className="text-slate-100">/actions</code>, <code className="text-slate-100">/examples</code></div>
            </div>
          </div>
        </div>
      </Card>

      {obsData && obsData.observations.length > 0 && (
        <Card>
          <h2 className="text-sm font-semibold text-slate-300 mb-3">Recent Observations</h2>
          <div className="space-y-2">
            {obsData.observations.slice(-5).reverse().map((o) => (
              <div key={o.id} className="flex items-start gap-3 py-2 border-b border-slate-700 last:border-0">
                <Badge variant={o.severity === "warning" ? "warning" : o.severity === "blocked" ? "danger" : "info"}>
                  {o.severity}
                </Badge>
                <div>
                  <div className="text-sm text-white">{o.title}</div>
                  <div className="text-xs text-slate-400">{o.body.slice(0, 100)}</div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

function ProjectsPage() {
  const { data, isLoading } = useQuery({ queryKey: ["projects"], queryFn: api.projects.list });
  const { data: providerData } = useQuery({ queryKey: ["providers"], queryFn: api.providers.list });
  const qc = useQueryClient();
  const [adding, setAdding] = React.useState(false);
  const [name, setName] = React.useState("");
  const [rootPath, setRootPath] = React.useState("");

  const addMut = useMutation({
    mutationFn: api.projects.add,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["projects"] });
      setAdding(false);
      setName("");
      setRootPath("");
    },
  });

  const updateProjectMut = useMutation({
    mutationFn: ({ id, codingProviderId }: { id: string; codingProviderId: string | null }) =>
      api.projects.update(id, { codingProviderId }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["projects"] });
    },
  });

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">Projects</h1>
        <button
          onClick={() => setAdding(true)}
          className="px-4 py-2 bg-feather-600 hover:bg-feather-500 text-white text-sm rounded transition-colors"
        >
          + Add Project
        </button>
      </div>

      {adding && (
        <Card>
          <h2 className="text-sm font-semibold text-slate-300 mb-3">Add Project</h2>
          <div className="space-y-3">
            <input
              className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm text-white"
              placeholder="Project name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <input
              className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm text-white"
              placeholder="Root path (e.g. C:\Projects\MyApp)"
              value={rootPath}
              onChange={(e) => setRootPath(e.target.value)}
            />
            <div className="flex gap-2">
              <button
                disabled={!name || !rootPath || addMut.isPending}
                onClick={() => addMut.mutate({ name, rootPath })}
                className="px-4 py-2 bg-feather-600 hover:bg-feather-500 disabled:opacity-50 text-white text-sm rounded"
              >
                Add
              </button>
              <button onClick={() => setAdding(false)} className="px-4 py-2 text-slate-400 hover:text-white text-sm">
                Cancel
              </button>
            </div>
            {addMut.isError && <div className="text-red-400 text-sm">{(addMut.error as Error).message}</div>}
          </div>
        </Card>
      )}

      {isLoading && <div className="text-slate-400">Loading...</div>}

      <div className="space-y-3">
        {data?.projects.map((p) => (
          <Card key={p.id} className="hover:border-slate-600 transition-colors cursor-pointer">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="font-semibold text-white">{p.name}</div>
                <div className="text-sm text-slate-400">{p.rootPath}</div>
              </div>
              <div className="flex flex-col items-end gap-2 min-w-[220px]">
                {p.heartbeatEnabled && <Badge variant="info">♥ heartbeat</Badge>}
                <select
                  value={p.codingProviderId ?? ""}
                  onChange={(e) => updateProjectMut.mutate({ id: p.id, codingProviderId: e.target.value || null })}
                  className="bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm text-white w-full"
                >
                  <option value="">No coding provider</option>
                  {providerData?.providers.map((provider) => (
                    <option key={provider.id} value={provider.id}>{provider.name}</option>
                  ))}
                </select>
              </div>
            </div>
          </Card>
        ))}
      </div>

      {data?.projects.length === 0 && (
        <div className="text-center py-12 text-slate-500">
          No projects yet. Add your first project to get started.
        </div>
      )}
    </div>
  );
}

function TasksPage() {
  const { data, isLoading } = useQuery({ queryKey: ["tasks"], queryFn: () => api.tasks.list(), refetchInterval: 3000 });

  const statusColor = (s: string) => ({
    running: "success",
    queued: "info",
    completed: "default",
    failed: "danger",
    cancelled: "default",
    awaiting_approval: "warning",
    blocked: "danger",
    planning: "info",
  }[s] ?? "default") as "success" | "info" | "default" | "danger" | "warning";

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-bold text-white">Tasks</h1>
      {isLoading && <div className="text-slate-400">Loading...</div>}
      <div className="space-y-2">
        {data?.tasks.map((t) => (
          <Card key={t.id} className="hover:border-slate-600 transition-colors">
            <div className="flex items-start gap-3">
              <Badge variant={statusColor(t.status)}>{t.status}</Badge>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-white truncate">{t.title}</div>
                <div className="text-xs text-slate-400">{t.providerId} · {new Date(t.createdAt).toLocaleString()} {t.skillId ? `· skill ${t.skillId}` : ""}</div>
              </div>
            </div>
          </Card>
        ))}
      </div>
      {data?.tasks.length === 0 && (
        <div className="text-center py-12 text-slate-500">No tasks yet.</div>
      )}
    </div>
  );
}

function ApprovalsPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["approvals"], queryFn: () => api.approvals.list(), refetchInterval: 5000 });

  const resolveMut = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: "approved" | "rejected" }) =>
      api.approvals.resolve(id, decision, "once"),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["approvals"] }),
  });

  const riskVariant = (r: string) => r === "dangerous" ? "danger" : r === "review" ? "warning" : "success";

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-bold text-white">Approvals</h1>
      {isLoading && <div className="text-slate-400">Loading...</div>}

      {data?.approvals.length === 0 && (
        <div className="text-center py-12 text-slate-500">No pending approvals. ✓</div>
      )}

      <div className="space-y-3">
        {data?.approvals.map((a) => (
          <Card key={a.id} className="border-l-4 border-l-yellow-500">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <Badge variant={riskVariant(a.risk) as "danger" | "warning" | "success"}>{a.risk}</Badge>
                  <Badge variant="default">{a.actionType}</Badge>
                  <span className="font-medium text-white">{a.title}</span>
                </div>
                <p className="text-sm text-slate-400">{a.reason}</p>
                <ApprovalPayloadPreview payload={a.payload} />
              </div>
              <div className="flex gap-2 shrink-0">
                <button
                  onClick={() => resolveMut.mutate({ id: a.id, decision: "approved" })}
                  className="px-3 py-1.5 bg-emerald-700 hover:bg-emerald-600 text-white text-sm rounded transition-colors"
                >
                  Approve
                </button>
                <button
                  onClick={() => resolveMut.mutate({ id: a.id, decision: "rejected" })}
                  className="px-3 py-1.5 bg-red-800 hover:bg-red-700 text-white text-sm rounded transition-colors"
                >
                  Reject
                </button>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

function HeartbeatPage() {
  const qc = useQueryClient();
  const { data: projectsData } = useQuery({ queryKey: ["projects"], queryFn: api.projects.list });
  const { data: obsData, isLoading } = useQuery({ queryKey: ["observations"], queryFn: () => api.heartbeat.observations() });
  const [selectedProjectId, setSelectedProjectId] = React.useState("");
  const { data: projectConfigData } = useQuery({
    queryKey: ["project-config", selectedProjectId],
    queryFn: () => api.projects.config(selectedProjectId),
    enabled: Boolean(selectedProjectId),
  });
  const [heartbeatForm, setHeartbeatForm] = React.useState({
    enabled: true,
    mode: "passive" as "off" | "manual" | "passive" | "proactive",
    intervalMinutes: 30,
    quietStart: "22:30",
    quietEnd: "08:00",
    gitDirtyEnabled: true,
    gitDirtyCooldown: 120,
    pendingApprovalsEnabled: true,
    pendingApprovalsCooldown: 30,
    dailyRecapEnabled: true,
    dailyRecapTime: "21:30",
    instructions: "",
  });
  const runMut = useMutation({
    mutationFn: api.heartbeat.run,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["observations"] }),
  });
  const saveMut = useMutation({
    mutationFn: () => api.projects.updateHeartbeat(selectedProjectId, {
      enabled: heartbeatForm.enabled,
      mode: heartbeatForm.mode,
      intervalMinutes: heartbeatForm.intervalMinutes,
      quietHours: { start: heartbeatForm.quietStart, end: heartbeatForm.quietEnd },
      checks: {
        git_dirty: { enabled: heartbeatForm.gitDirtyEnabled, cooldownMinutes: heartbeatForm.gitDirtyCooldown },
        pending_approvals: { enabled: heartbeatForm.pendingApprovalsEnabled, cooldownMinutes: heartbeatForm.pendingApprovalsCooldown },
        daily_recap: { enabled: heartbeatForm.dailyRecapEnabled, time: heartbeatForm.dailyRecapTime || undefined },
      },
      instructions: heartbeatForm.instructions.split(/\r?\n/).map((line) => line.trim()).filter(Boolean),
    }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["project-config", selectedProjectId] });
      void qc.invalidateQueries({ queryKey: ["observations"] });
    },
  });

  React.useEffect(() => {
    if (!selectedProjectId && projectsData?.projects[0]) {
      setSelectedProjectId(projectsData.projects[0].id);
    }
  }, [projectsData, selectedProjectId]);

  React.useEffect(() => {
    const heartbeat = projectConfigData?.config?.heartbeat;
    if (!heartbeat) {
      return;
    }
    const gitDirty = typeof heartbeat.checks?.git_dirty === "boolean"
      ? { enabled: heartbeat.checks.git_dirty, cooldownMinutes: 120 }
      : heartbeat.checks?.git_dirty;
    const pendingApprovals = typeof heartbeat.checks?.pending_approvals === "boolean"
      ? { enabled: heartbeat.checks.pending_approvals, cooldownMinutes: 30 }
      : heartbeat.checks?.pending_approvals;
    const dailyRecap = typeof heartbeat.checks?.daily_recap === "boolean"
      ? { enabled: heartbeat.checks.daily_recap, time: "21:30" }
      : heartbeat.checks?.daily_recap;
    setHeartbeatForm({
      enabled: heartbeat.enabled ?? true,
      mode: (heartbeat.mode === "off" || heartbeat.mode === "manual" || heartbeat.mode === "proactive") ? heartbeat.mode : "passive",
      intervalMinutes: heartbeat.intervalMinutes ?? heartbeat.interval_minutes ?? 30,
      quietStart: heartbeat.quietHours?.start ?? heartbeat.quiet_hours?.start ?? "22:30",
      quietEnd: heartbeat.quietHours?.end ?? heartbeat.quiet_hours?.end ?? "08:00",
      gitDirtyEnabled: gitDirty?.enabled ?? true,
      gitDirtyCooldown: gitDirty?.cooldownMinutes ?? gitDirty?.cooldown_minutes ?? 120,
      pendingApprovalsEnabled: pendingApprovals?.enabled ?? true,
      pendingApprovalsCooldown: pendingApprovals?.cooldownMinutes ?? pendingApprovals?.cooldown_minutes ?? 30,
      dailyRecapEnabled: dailyRecap?.enabled ?? true,
      dailyRecapTime: dailyRecap?.time ?? "21:30",
      instructions: (heartbeat.instructions ?? []).join("\n"),
    });
  }, [projectConfigData]);

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">Heartbeat</h1>
        <button
          onClick={() => runMut.mutate()}
          disabled={runMut.isPending}
          className="px-4 py-2 bg-feather-600 hover:bg-feather-500 disabled:opacity-50 text-white text-sm rounded"
        >
          {runMut.isPending ? "Running..." : "Run Now"}
        </button>
      </div>

      <Card>
        <div className="space-y-3">
          <div>
            <div className="font-medium text-white">Project heartbeat settings</div>
            <div className="text-xs text-slate-400 mt-1">Passive mode observes and summarizes. Proactive mode can suggest tasks, but it still does not start them automatically.</div>
          </div>
          <div className="grid md:grid-cols-2 gap-3">
            <select value={selectedProjectId} onChange={(e) => setSelectedProjectId(e.target.value)} className="bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm text-white md:col-span-2">
              <option value="">Select project</option>
              {projectsData?.projects.map((project) => (
                <option key={project.id} value={project.id}>{project.name}</option>
              ))}
            </select>
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input type="checkbox" checked={heartbeatForm.enabled} onChange={(e) => setHeartbeatForm((current) => ({ ...current, enabled: e.target.checked }))} className="rounded border-slate-600 bg-slate-900 text-feather-500" />
              Heartbeat enabled
            </label>
            <select value={heartbeatForm.mode} onChange={(e) => setHeartbeatForm((current) => ({ ...current, mode: e.target.value as typeof current.mode }))} className="bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm text-white">
              <option value="off">off</option>
              <option value="manual">manual</option>
              <option value="passive">passive</option>
              <option value="proactive">proactive</option>
            </select>
            <input type="number" min={1} value={heartbeatForm.intervalMinutes} onChange={(e) => setHeartbeatForm((current) => ({ ...current, intervalMinutes: Number(e.target.value) || 30 }))} placeholder="Interval minutes" className="bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm text-white" />
            <input value={heartbeatForm.quietStart} onChange={(e) => setHeartbeatForm((current) => ({ ...current, quietStart: e.target.value }))} placeholder="Quiet start" className="bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm text-white" />
            <input value={heartbeatForm.quietEnd} onChange={(e) => setHeartbeatForm((current) => ({ ...current, quietEnd: e.target.value }))} placeholder="Quiet end" className="bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm text-white" />
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input type="checkbox" checked={heartbeatForm.gitDirtyEnabled} onChange={(e) => setHeartbeatForm((current) => ({ ...current, gitDirtyEnabled: e.target.checked }))} className="rounded border-slate-600 bg-slate-900 text-feather-500" />
              git dirty check
            </label>
            <input type="number" min={0} value={heartbeatForm.gitDirtyCooldown} onChange={(e) => setHeartbeatForm((current) => ({ ...current, gitDirtyCooldown: Number(e.target.value) || 0 }))} placeholder="git dirty cooldown" className="bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm text-white" />
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input type="checkbox" checked={heartbeatForm.pendingApprovalsEnabled} onChange={(e) => setHeartbeatForm((current) => ({ ...current, pendingApprovalsEnabled: e.target.checked }))} className="rounded border-slate-600 bg-slate-900 text-feather-500" />
              pending approvals check
            </label>
            <input type="number" min={0} value={heartbeatForm.pendingApprovalsCooldown} onChange={(e) => setHeartbeatForm((current) => ({ ...current, pendingApprovalsCooldown: Number(e.target.value) || 0 }))} placeholder="pending approvals cooldown" className="bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm text-white" />
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input type="checkbox" checked={heartbeatForm.dailyRecapEnabled} onChange={(e) => setHeartbeatForm((current) => ({ ...current, dailyRecapEnabled: e.target.checked }))} className="rounded border-slate-600 bg-slate-900 text-feather-500" />
              daily recap note
            </label>
            <input value={heartbeatForm.dailyRecapTime} onChange={(e) => setHeartbeatForm((current) => ({ ...current, dailyRecapTime: e.target.value }))} placeholder="daily recap time" className="bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm text-white" />
            <textarea value={heartbeatForm.instructions} onChange={(e) => setHeartbeatForm((current) => ({ ...current, instructions: e.target.value }))} rows={4} placeholder="Only notify me about shipping blockers." className="bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm text-white md:col-span-2" />
          </div>
          <div className="flex justify-end">
            <button disabled={!selectedProjectId || saveMut.isPending} onClick={() => saveMut.mutate()} className="px-4 py-2 bg-feather-600 hover:bg-feather-500 disabled:opacity-50 text-white text-sm rounded">
              Save settings
            </button>
          </div>
        </div>
      </Card>

      {runMut.isSuccess && (
        <div className="text-sm text-emerald-400 bg-emerald-900/20 rounded p-3">
          {runMut.data.summary}
        </div>
      )}

      {isLoading && <div className="text-slate-400">Loading...</div>}

      <div className="space-y-2">
        {obsData?.observations.slice().reverse().map((o) => (
          <Card key={o.id}>
            <div className="flex items-start gap-3">
              <Badge variant={o.severity === "warning" ? "warning" : o.severity === "blocked" ? "danger" : "info"}>
                {o.severity}
              </Badge>
              <div className="flex-1">
                <div className="text-sm font-medium text-white">{o.title}</div>
                <p className="text-xs text-slate-400 mt-0.5">{o.body}</p>
                {o.suggestedActions.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {o.suggestedActions.map((action) => (
                      <span key={action.id} className="text-xs px-2 py-0.5 bg-slate-700 rounded text-slate-300">
                        {action.label}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <div className="text-xs text-slate-500 shrink-0">{new Date(o.createdAt).toLocaleString()}</div>
            </div>
          </Card>
        ))}
      </div>

      {obsData?.observations.length === 0 && (
        <div className="text-center py-12 text-slate-500">No observations yet. Run the heartbeat to check your projects.</div>
      )}
    </div>
  );
}

function MemoryPage() {
  const qc = useQueryClient();
  const { data: memoryData, isLoading } = useQuery({ queryKey: ["memories"], queryFn: () => api.memories.list() });
  const { data: projectData } = useQuery({ queryKey: ["projects"], queryFn: api.projects.list });
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [scope, setScope] = React.useState<"global" | "project">("global");
  const [projectId, setProjectId] = React.useState("");
  const [kind, setKind] = React.useState<MemoryKind>("preference");
  const [content, setContent] = React.useState("");

  const resetForm = React.useCallback(() => {
    setEditingId(null);
    setScope("global");
    setProjectId("");
    setKind("preference");
    setContent("");
  }, []);

  const saveMut = useMutation({
    mutationFn: async () => {
      if (editingId) {
        return api.memories.update(editingId, {
          kind,
          content,
          ...(scope === "project" && projectId ? { projectId } : {}),
        });
      }
      return api.memories.create({
        scope,
        ...(scope === "project" && projectId ? { projectId } : {}),
        kind,
        content,
      });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["memories"] });
      resetForm();
    },
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.memories.delete(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["memories"] }),
  });

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-bold text-white">Memory</h1>
      <Card>
        <div className="space-y-3">
          <div>
            <div className="font-medium text-white">Explicit operator memory</div>
            <div className="text-xs text-slate-400 mt-1">Memories are explicit context Feather can include in task prompts. They do not grant permissions and cannot bypass approvals, panic, budgets, or denied paths.</div>
          </div>
          <div className="grid md:grid-cols-3 gap-3">
            <select value={scope} onChange={(e) => setScope(e.target.value as "global" | "project")} className="bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm text-white">
              <option value="global">Global</option>
              <option value="project">Project</option>
            </select>
            <select value={projectId} onChange={(e) => setProjectId(e.target.value)} disabled={scope !== "project"} className="bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm text-white disabled:opacity-50">
              <option value="">Select project</option>
              {projectData?.projects.map((project) => (
                <option key={project.id} value={project.id}>{project.name}</option>
              ))}
            </select>
            <select value={kind} onChange={(e) => setKind(e.target.value as MemoryKind)} className="bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm text-white">
              <option value="preference">preference</option>
              <option value="fact">fact</option>
              <option value="decision">decision</option>
              <option value="constraint">constraint</option>
              <option value="workflow">workflow</option>
            </select>
          </div>
          <textarea value={content} onChange={(e) => setContent(e.target.value)} rows={4} placeholder="Keep task summaries short and direct." className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm text-white" />
          <div className="flex justify-end gap-2">
            {editingId && (
              <button onClick={resetForm} className="px-3 py-1.5 rounded border border-slate-600 hover:border-slate-400 text-slate-300 hover:text-white text-sm transition-colors">
                Cancel edit
              </button>
            )}
            <button disabled={!content.trim() || (scope === "project" && !projectId) || saveMut.isPending} onClick={() => saveMut.mutate()} className="px-3 py-1.5 rounded bg-feather-600 hover:bg-feather-500 disabled:opacity-50 text-white text-sm transition-colors">
              {editingId ? "Update memory" : "Save memory"}
            </button>
          </div>
        </div>
      </Card>

      {isLoading && <div className="text-slate-400">Loading...</div>}

      <div className="space-y-3">
        {memoryData?.memories.map((memory) => (
          <Card key={memory.id}>
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Badge variant={memory.scope === "project" ? "info" : "default"}>{memory.scope}</Badge>
                  <Badge variant="warning">{memory.kind}</Badge>
                  {memory.projectId && <span className="text-xs text-slate-500">{projectData?.projects.find((project) => project.id === memory.projectId)?.name ?? memory.projectId}</span>}
                </div>
                <div className="text-sm text-white whitespace-pre-wrap">{memory.content}</div>
              </div>
              <div className="flex gap-2 shrink-0">
                <button
                  onClick={() => {
                    setEditingId(memory.id);
                    setScope(memory.scope);
                    setProjectId(memory.projectId ?? "");
                    setKind(memory.kind);
                    setContent(memory.content);
                  }}
                  className="px-3 py-1.5 border border-slate-600 hover:border-slate-400 text-slate-300 hover:text-white text-sm rounded transition-colors"
                >
                  Edit
                </button>
                <button
                  onClick={() => deleteMut.mutate(memory.id)}
                  className="px-3 py-1.5 border border-red-700 hover:border-red-500 text-red-300 hover:text-white text-sm rounded transition-colors"
                >
                  Delete
                </button>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

function SkillsPage() {
  const qc = useQueryClient();
  const { data: skillData, isLoading } = useQuery({ queryKey: ["skills"], queryFn: () => api.skills.list() });
  const { data: projectData } = useQuery({ queryKey: ["projects"], queryFn: api.projects.list });
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [form, setForm] = React.useState<SkillFormState>(() => createDefaultSkillForm());

  const resetForm = React.useCallback(() => {
    setEditingId(null);
    setForm(createDefaultSkillForm());
  }, []);

  const saveMut = useMutation({
    mutationFn: async () => {
      const payload = {
        scope: form.scope,
        ...(form.scope === "project" && form.projectId ? { projectId: form.projectId } : {}),
        id: form.id,
        name: form.name,
        purpose: form.purpose || undefined,
        allowedTools: form.allowedTools.split(/\r?\n|,/).map((tool) => tool.trim()).filter(Boolean),
        instructions: form.instructions,
        output: form.output || undefined,
      };
      if (editingId) {
        return api.skills.update(editingId, payload);
      }
      return api.skills.create(payload);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["skills"] });
      resetForm();
    },
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.skills.delete(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["skills"] }),
  });

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-bold text-white">Skills</h1>
      <Card>
        <div className="space-y-3">
          <div>
            <div className="font-medium text-white">Local workflow packs</div>
            <div className="text-xs text-slate-400 mt-1">Skills are local Markdown workflow files. They narrow task behavior but do not bypass approvals or permissions.</div>
          </div>
          <div className="grid md:grid-cols-2 gap-3">
            <select value={form.scope} onChange={(e) => setForm((current) => ({ ...current, scope: e.target.value as "global" | "project" }))} className="bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm text-white">
              <option value="global">Global</option>
              <option value="project">Project</option>
            </select>
            <select value={form.projectId} onChange={(e) => setForm((current) => ({ ...current, projectId: e.target.value }))} disabled={form.scope !== "project"} className="bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm text-white disabled:opacity-50">
              <option value="">Select project</option>
              {projectData?.projects.map((project) => (
                <option key={project.id} value={project.id}>{project.name}</option>
              ))}
            </select>
            <input value={form.id} onChange={(e) => setForm((current) => ({ ...current, id: e.target.value }))} disabled={editingId !== null} placeholder="safe-ui-pass" className="bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm text-white disabled:opacity-50" />
            <input value={form.name} onChange={(e) => setForm((current) => ({ ...current, name: e.target.value }))} placeholder="Safe UI Pass" className="bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm text-white" />
            <input value={form.purpose} onChange={(e) => setForm((current) => ({ ...current, purpose: e.target.value }))} placeholder="Improve UI without changing functionality." className="bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm text-white md:col-span-2" />
            <textarea value={form.allowedTools} onChange={(e) => setForm((current) => ({ ...current, allowedTools: e.target.value }))} rows={3} placeholder="filesystem.readFile&#10;filesystem.writeFile with approval&#10;shell.run: npm test" className="bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm text-white md:col-span-2" />
            <textarea value={form.instructions} onChange={(e) => setForm((current) => ({ ...current, instructions: e.target.value }))} rows={5} placeholder="Do not add new features." className="bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm text-white md:col-span-2" />
            <textarea value={form.output} onChange={(e) => setForm((current) => ({ ...current, output: e.target.value }))} rows={3} placeholder="summary\nfiles changed\nverification result" className="bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm text-white md:col-span-2" />
          </div>
          <div className="flex justify-end gap-2">
            {editingId && (
              <button onClick={resetForm} className="px-3 py-1.5 rounded border border-slate-600 hover:border-slate-400 text-slate-300 hover:text-white text-sm transition-colors">
                Cancel edit
              </button>
            )}
            <button disabled={!form.id || !form.name || !form.instructions.trim() || (form.scope === "project" && !form.projectId) || saveMut.isPending} onClick={() => saveMut.mutate()} className="px-3 py-1.5 rounded bg-feather-600 hover:bg-feather-500 disabled:opacity-50 text-white text-sm transition-colors">
              {editingId ? "Update skill" : "Save skill"}
            </button>
          </div>
        </div>
      </Card>

      {isLoading && <div className="text-slate-400">Loading...</div>}

      <div className="space-y-3">
        {skillData?.skills.map((skill) => (
          <Card key={skill.id}>
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-2 min-w-0">
                <div className="flex items-center gap-2">
                  <Badge variant={skill.scope === "project" ? "info" : "default"}>{skill.scope}</Badge>
                  <span className="font-medium text-white">{skill.name}</span>
                </div>
                {skill.purpose && <div className="text-sm text-slate-400">{skill.purpose}</div>}
                <div className="text-xs text-slate-500">{skill.id}</div>
                {skill.allowedTools.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {skill.allowedTools.map((tool) => (
                      <Badge key={tool} variant="info">{tool}</Badge>
                    ))}
                  </div>
                )}
                <div className="text-sm text-white whitespace-pre-wrap">{skill.instructions}</div>
              </div>
              <div className="flex gap-2 shrink-0">
                <button
                  onClick={() => {
                    setEditingId(skill.id);
                    setForm({
                      scope: skill.scope,
                      projectId: skill.projectId ?? "",
                      id: skill.id.split(":").slice(-1)[0] ?? skill.id,
                      name: skill.name,
                      purpose: skill.purpose ?? "",
                      allowedTools: skill.allowedTools.join("\n"),
                      instructions: skill.instructions,
                      output: skill.output ?? "",
                    });
                  }}
                  className="px-3 py-1.5 border border-slate-600 hover:border-slate-400 text-slate-300 hover:text-white text-sm rounded transition-colors"
                >
                  Edit
                </button>
                <button
                  onClick={() => deleteMut.mutate(skill.id)}
                  className="px-3 py-1.5 border border-red-700 hover:border-red-500 text-red-300 hover:text-white text-sm rounded transition-colors"
                >
                  Delete
                </button>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

function ProvidersPage() {
  const { data, isLoading } = useQuery({ queryKey: ["providers"], queryFn: api.providers.list });
  const qc = useQueryClient();
  const [testResults, setTestResults] = React.useState<Record<string, { ok: boolean; message: string }>>({});
  const [editingProviderId, setEditingProviderId] = React.useState<string | null>(null);
  const [form, setForm] = React.useState<ProviderFormState>(() => createDefaultProviderForm());
  const modelOptions = form.type === "codex-cli" ? [] : getProviderModelOptions(form.type);
  const usingCustomModel = isCustomProviderModel(form);

  const resetForm = React.useCallback(() => {
    setEditingProviderId(null);
    setForm(createDefaultProviderForm());
  }, []);

  const saveMut = useMutation({
    mutationFn: () => api.providers.create(serializeProviderForm(form)),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["providers"] });
      resetForm();
    },
  });

  const testMut = useMutation({
    mutationFn: ({ id }: { id: string }) => api.providers.validate(id),
    onSuccess: (data, { id }) => setTestResults((r) => ({ ...r, [id]: data.health })),
  });

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-bold text-white">Providers</h1>
      {isLoading && <div className="text-slate-400">Loading...</div>}

      <Card>
        <div className="space-y-3">
          <div>
            <div className="font-medium text-white">{editingProviderId ? `Editing provider ${editingProviderId}` : "Add provider"}</div>
            <div className="text-xs text-slate-400 mt-1">Configure Codex CLI, OpenAI, OpenRouter, or an OpenAI-compatible endpoint without leaking raw keys back to the dashboard.</div>
          </div>
          <div className="flex items-center justify-between rounded border border-slate-700 bg-slate-900/60 px-3 py-2 text-xs text-slate-400">
            <span>OpenAI-style providers default to `gpt-4o-mini`. Some models require account access. If validation fails, use `gpt-4o-mini` or Custom. OpenAI-compatible endpoints often need a custom model name.</span>
            {editingProviderId && (
              <button onClick={resetForm} className="text-slate-300 hover:text-white transition-colors">
                Cancel edit
              </button>
            )}
          </div>
          <div className="grid md:grid-cols-2 gap-3">
            <input value={form.id} onChange={(e) => setForm((current) => ({ ...current, id: e.target.value }))} placeholder="provider id" disabled={editingProviderId !== null} className="bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm text-white disabled:opacity-60" />
            <input value={form.name} onChange={(e) => setForm((current) => ({ ...current, name: e.target.value }))} placeholder="display name" className="bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm text-white" />
            <select value={form.type} disabled={editingProviderId !== null} onChange={(e) => setForm((current) => applyProviderTypeDefaults(current, e.target.value as ProviderFormState["type"]))} className="bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm text-white disabled:opacity-60">
              <option value="codex-cli">codex-cli</option>
              <option value="openai">openai</option>
              <option value="openai-compatible">openai-compatible</option>
              <option value="openrouter">openrouter</option>
            </select>
            {form.type === "codex-cli" ? (
              <input value={form.command} onChange={(e) => setForm((current) => ({ ...current, command: e.target.value }))} placeholder="codex command" className="bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm text-white" />
            ) : (
              <div className="md:col-span-2 rounded border border-slate-700 bg-slate-900/60 p-3 text-sm text-slate-300">
                <div className="font-medium text-white">Credentials</div>
                <div className="mt-1 text-xs text-slate-400">Paste a key and Feather stores it only in `~/.feather/.env.local`, or point at an existing environment variable.</div>
                <div className="mt-3 grid gap-2 md:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => setForm((current) => ({ ...current, credentialMode: "local" }))}
                    className={clsx(
                      "rounded border px-3 py-2 text-left text-sm transition-colors",
                      form.credentialMode === "local"
                        ? "border-feather-500 bg-feather-500/10 text-white"
                        : "border-slate-700 bg-slate-950 text-slate-300 hover:border-slate-500",
                    )}
                  >
                    Paste API key directly
                  </button>
                  <button
                    type="button"
                    onClick={() => setForm((current) => ({ ...current, credentialMode: "env", apiKeyValue: "", apiKeyStoredLocally: false }))}
                    className={clsx(
                      "rounded border px-3 py-2 text-left text-sm transition-colors",
                      form.credentialMode === "env"
                        ? "border-feather-500 bg-feather-500/10 text-white"
                        : "border-slate-700 bg-slate-950 text-slate-300 hover:border-slate-500",
                    )}
                  >
                    Use environment variable
                  </button>
                </div>
                <div className="mt-3">
                  {form.credentialMode === "local" ? (
                    <div className="space-y-2">
                      <input value={form.apiKeyValue} onChange={(e) => setForm((current) => ({ ...current, apiKeyValue: e.target.value, apiKeyStoredLocally: current.apiKeyStoredLocally && e.target.value.length === 0 }))} type="password" placeholder={form.apiKeyStoredLocally ? "Leave blank to keep the stored key" : "Paste API key"} className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-sm text-white" />
                      <div className="text-xs text-slate-400">
                        {form.apiKeyStoredLocally && !form.apiKeyValue
                          ? "A key is already stored locally for this provider. Leave the field blank to keep it."
                          : "The pasted key never comes back from the API after save."}
                      </div>
                    </div>
                  ) : (
                    <input value={form.apiKeyEnv} onChange={(e) => setForm((current) => ({ ...current, apiKeyEnv: e.target.value }))} placeholder="API key env var" className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-sm text-white" />
                  )}
                </div>
              </div>
            )}
            {form.type === "codex-cli" ? (
              <div className="space-y-2">
                <select value={form.mode} onChange={(e) => setForm((current) => ({ ...current, mode: e.target.value as ProviderFormState["mode"] }))} className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm text-white">
                  <option value="exec">exec</option>
                  <option value="apply">apply</option>
                </select>
                <div className="text-xs text-slate-500">Mode is currently informational only and does not bypass Feather approvals.</div>
              </div>
            ) : (
              <div className="space-y-2">
                <select value={usingCustomModel ? "__custom__" : form.model} onChange={(e) => setForm((current) => ({ ...current, model: e.target.value === "__custom__" ? current.model : e.target.value }))} className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm text-white">
                  {modelOptions.map((option) => (
                    <option key={option} value={option}>{option}</option>
                  ))}
                  <option value="__custom__">Custom...</option>
                </select>
                {usingCustomModel && (
                  <input value={form.model} onChange={(e) => setForm((current) => ({ ...current, model: e.target.value }))} placeholder="Custom model name" className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-sm text-white" />
                )}
                <div className="text-xs text-slate-500">Some models require account access. If validation fails, use gpt-4o-mini or Custom. OpenAI-compatible endpoints often need a custom model name.</div>
              </div>
            )}
            {form.type !== "codex-cli" && (form.type === "openai" || form.type === "openai-compatible") && (
              <input value={form.baseUrl} onChange={(e) => setForm((current) => ({ ...current, baseUrl: e.target.value }))} placeholder="base url" className="bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm text-white md:col-span-2" />
            )}
            {form.type !== "codex-cli" && (
              <>
                <input value={form.maxTaskCents} onChange={(e) => setForm((current) => ({ ...current, maxTaskCents: e.target.value }))} placeholder="max task cents (optional)" className="bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm text-white md:col-span-2" />
                <div className="md:col-span-2 rounded border border-slate-700 bg-slate-900/60 p-3 text-xs text-slate-400">
                  <div>Optional pricing for budget estimates.</div>
                  <div>Leave blank if you do not know the provider pricing.</div>
                  <div>Without pricing, Feather can record token usage but cannot enforce hard spend limits.</div>
                </div>
                <input value={form.inputCentsPer1MTokens} onChange={(e) => setForm((current) => ({ ...current, inputCentsPer1MTokens: e.target.value }))} placeholder="input cents per 1M tokens (optional)" className="bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm text-white" />
                <input value={form.outputCentsPer1MTokens} onChange={(e) => setForm((current) => ({ ...current, outputCentsPer1MTokens: e.target.value }))} placeholder="output cents per 1M tokens (optional)" className="bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm text-white" />
              </>
            )}
            <label className="md:col-span-2 flex items-center gap-2 text-sm text-slate-300">
              <input type="checkbox" checked={form.enabled} onChange={(e) => setForm((current) => ({ ...current, enabled: e.target.checked }))} className="rounded border-slate-600 bg-slate-900 text-feather-500" />
              Provider enabled
            </label>
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={resetForm} className="px-3 py-1.5 rounded border border-slate-600 hover:border-slate-400 text-slate-300 hover:text-white text-sm transition-colors">
              Reset
            </button>
            <button onClick={() => saveMut.mutate()} disabled={saveMut.isPending || !isProviderFormValid(form)} className="px-3 py-1.5 rounded bg-feather-600 hover:bg-feather-500 disabled:opacity-50 text-white text-sm transition-colors">
              {saveMut.isPending ? "Saving..." : editingProviderId ? "Update provider" : "Save provider"}
            </button>
          </div>
        </div>
      </Card>

      {data?.providers.length === 0 && (
        <div className="text-center py-12 text-slate-500">
          No providers configured yet.
        </div>
      )}

      <div className="space-y-3">
        {data?.providers.map((p) => (
          <Card key={p.id}>
            <div className="flex items-start justify-between">
              <div>
                <div className="font-medium text-white">{p.name}</div>
                <div className="text-xs text-slate-400">{p.type} · {p.id} {p.enabled ? "· enabled" : "· disabled"}</div>
                <div className="flex flex-wrap gap-1 mt-2">
                  {p.capabilities?.streaming && <Badge variant="info">streaming</Badge>}
                  {p.capabilities?.toolCalling && <Badge variant="info">tools</Badge>}
                  {p.capabilities?.coding && <Badge variant="success">coding</Badge>}
                  {p.capabilities?.costEstimate && <Badge variant="default">cost</Badge>}
                </div>
                <div className="mt-3 space-y-1 text-xs text-slate-400">
                  <div>Streaming: {p.capabilities?.streaming ? "yes" : "no"}</div>
                  <div>Coding: {p.capabilities?.coding ? "yes" : "no"}</div>
                  <div>Native tool calling: {p.capabilities?.toolCalling ? "yes" : "no"}</div>
                  <div>Cost enforcement: {formatCostMode(p.costEnforcementMode)}</div>
                  <div>{getBudgetEnforcementLabel(p.costEnforcementMode)}</div>
                  {p.type !== "codex-cli" && <div>Credentials: {getProviderCredentialSummary(p.config)}</div>}
                  {typeof p.config.model === "string" && <div>Model: {p.config.model}</div>}
                </div>
                <div className="mt-2 text-xs text-slate-500">{p.budgetWarning}</div>
                {testResults[p.id] && (
                  <div className={clsx("text-xs mt-2", testResults[p.id]!.ok ? "text-emerald-400" : "text-red-400")}>
                    {testResults[p.id]!.ok ? "✓" : "✗"} {testResults[p.id]!.message}
                  </div>
                )}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    setEditingProviderId(p.id);
                    setForm(providerToForm(p));
                  }}
                  className="px-3 py-1.5 border border-slate-600 hover:border-slate-400 text-slate-300 hover:text-white text-sm rounded transition-colors"
                >
                  Edit
                </button>
                <button
                  onClick={() => testMut.mutate({ id: p.id })}
                  disabled={testMut.isPending}
                  className="px-3 py-1.5 border border-slate-600 hover:border-slate-400 text-slate-300 hover:text-white text-sm rounded transition-colors"
                >
                  Test
                </button>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

function BudgetsPage() {
  const { data: providerData } = useQuery({ queryKey: ["providers"], queryFn: api.providers.list });
  const { data } = useQuery({ queryKey: ["daily-spend"], queryFn: () => api.budgets.dailySpend(), refetchInterval: 30000 });

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-bold text-white">Budgets</h1>
      <Card>
        <div className="text-slate-400 text-sm mb-1">Today's estimated spend</div>
        <div className="text-2xl font-bold text-white">
          ${((data?.dailySpendCents ?? 0) / 100).toFixed(2)}
        </div>
        <div className="text-xs text-slate-500 mt-1">Only providers with configured pricing contribute estimated spend. Providers with unknown pricing still record token usage.</div>
      </Card>

      <div className="space-y-2">
        {providerData?.providers.map((provider) => (
          <Card key={provider.id}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="font-medium text-white">{provider.name}</div>
                <div className="mt-1 text-sm text-slate-400">{getBudgetEnforcementLabel(provider.costEnforcementMode)}</div>
                <div className="mt-1 text-xs text-slate-500">Mode: {formatCostMode(provider.costEnforcementMode)}</div>
                <div className="mt-2 text-xs text-slate-500">{provider.budgetWarning}</div>
              </div>
              <Badge variant={provider.costEnforcementMode === "unknown" ? "warning" : "success"}>
                {formatCostMode(provider.costEnforcementMode)}
              </Badge>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

function LogsPage() {
  const { data } = useQuery({ queryKey: ["tasks"], queryFn: () => api.tasks.list(), refetchInterval: 5000 });

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-bold text-white">Logs</h1>
      <div className="font-mono text-xs bg-slate-900 rounded-lg p-4 space-y-1 max-h-[70vh] overflow-y-auto">
        {data?.tasks.map((t) => (
          <div key={t.id} className="text-slate-400">
            <span className="text-slate-600">{t.createdAt}</span>{" "}
            <span className="text-feather-400">[{t.status}]</span>{" "}
            <span className="text-white">{t.title}</span>{" "}
            <span className="text-slate-500">via {t.providerId}</span>
          </div>
        ))}
        {!data?.tasks.length && <div className="text-slate-600">No task logs yet.</div>}
      </div>
    </div>
  );
}

function SettingsPage() {
  const qc = useQueryClient();
  const { data: health } = useQuery({ queryKey: ["health"], queryFn: api.health });
  const resumeMut = useMutation({
    mutationFn: api.resume,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["health"] }),
  });
  const panicMut = useMutation({
    mutationFn: api.panic,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["health"] }),
  });

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-bold text-white">Settings</h1>

      <Card>
        <h2 className="font-semibold text-white mb-3">Daemon Control</h2>
        <div className="flex gap-3">
          {health?.panic?.active ? (
            <button
              onClick={() => resumeMut.mutate()}
              className="px-4 py-2 bg-emerald-700 hover:bg-emerald-600 text-white text-sm rounded"
            >
              Resume from Panic
            </button>
          ) : (
            <button
              onClick={() => panicMut.mutate()}
              className="flex items-center gap-2 px-4 py-2 bg-red-800 hover:bg-red-700 text-white text-sm rounded"
            >
              <AlertTriangle size={14} />
              Activate Panic Mode
            </button>
          )}
        </div>
        <p className="text-xs text-slate-500 mt-3">
          Panic mode stops all active tasks, pauses heartbeat, and blocks new operations.
        </p>
      </Card>

      <Card>
        <h2 className="font-semibold text-white mb-2">Daemon Info</h2>
        <div className="text-sm text-slate-400 space-y-1">
          <div>Version: <span className="text-white">{health?.version ?? "—"}</span></div>
          <div>API: <span className="text-white">http://127.0.0.1:47383</span></div>
          <div>Status: <span className={health ? "text-emerald-400" : "text-red-400"}>{health ? "Connected" : "Unreachable"}</span></div>
        </div>
      </Card>
    </div>
  );
}

function OnboardingFlow({ state }: { state: OnboardingState }) {
  return (
    <div className="min-h-screen overflow-y-auto bg-slate-950 text-slate-100">
      <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-8 px-6 py-8 lg:flex-row lg:px-10">
        <aside className="lg:w-80 lg:shrink-0">
          <div className="sticky top-8 space-y-4">
            <div>
              <div className="text-sm uppercase tracking-[0.24em] text-feather-400">Feather onboarding</div>
              <h1 className="mt-3 text-4xl font-bold text-white">From machine setup to a working agent.</h1>
              <p className="mt-3 max-w-md text-sm leading-6 text-slate-400">
                First wire the machine-level pieces Feather needs to run. Then define the global agent profile that every project inherits.
              </p>
            </div>

            <Card className="space-y-4 border-feather-700/50 bg-slate-900/80">
              <div className="flex items-start gap-3">
                <div className={clsx("mt-1 flex h-8 w-8 items-center justify-center rounded-full border text-sm font-semibold", state.stage === "machine" ? "border-feather-400 bg-feather-500/10 text-feather-300" : "border-emerald-500/40 bg-emerald-500/10 text-emerald-300")}>1</div>
                <div>
                  <div className="font-semibold text-white">Machine setup</div>
                  <div className="mt-1 text-sm text-slate-400">Provider, Telegram decision, and first project registration.</div>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs">
                    <Badge variant={state.machine.providerCount > 0 ? "success" : "warning"}>{state.machine.providerCount} providers</Badge>
                    <Badge variant={state.machine.projectCount > 0 ? "success" : "warning"}>{state.machine.projectCount} projects</Badge>
                    <Badge variant={state.machine.telegramStepCompleted ? (state.machine.telegramConfigured ? "success" : "default") : "warning"}>
                      {state.machine.telegramConfigured ? "Telegram configured" : state.machine.telegramStepCompleted ? "Telegram skipped" : "Telegram undecided"}
                    </Badge>
                  </div>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className={clsx("mt-1 flex h-8 w-8 items-center justify-center rounded-full border text-sm font-semibold", state.stage === "agent" ? "border-feather-400 bg-feather-500/10 text-feather-300" : state.agent.complete ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" : "border-slate-700 bg-slate-800 text-slate-400")}>2</div>
                <div>
                  <div className="font-semibold text-white">Agent profile</div>
                  <div className="mt-1 text-sm text-slate-400">A chat-style builder writes your global {state.paths.globalAgentFilePath} profile.</div>
                  {state.agent.agentName && <div className="mt-2 text-xs text-slate-500">Current profile: {state.agent.agentName}</div>}
                </div>
              </div>
            </Card>

            <Card className="space-y-3 bg-slate-900/60">
              <div>
                <div className="text-xs uppercase tracking-[0.2em] text-slate-500">Paths</div>
                <div className="mt-2 text-sm text-slate-300">Feather home: {state.paths.featherHomeDir}</div>
                <div className="mt-1 text-sm text-slate-400">Config: {state.paths.globalConfigPath}</div>
                <div className="mt-1 text-sm text-slate-400">Agent file: {state.paths.globalAgentFilePath}</div>
              </div>
            </Card>
          </div>
        </aside>

        <section className="flex-1 pb-8">
          {state.stage === "machine" ? <MachineSetupStage state={state} /> : <AgentBuilderStage state={state} />}
        </section>
      </div>
    </div>
  );
}

function MachineSetupStage({ state }: { state: OnboardingState }) {
  const qc = useQueryClient();
  const { data: providerData } = useQuery({ queryKey: ["providers"], queryFn: api.providers.list });
  const requireProvider = state.machine.providerCount === 0;
  const requireProject = state.machine.projectCount === 0;
  const [createProvider, setCreateProvider] = React.useState(requireProvider);
  const [createProject, setCreateProject] = React.useState(requireProject);
  const [providerForm, setProviderForm] = React.useState<ProviderFormState>(() => ({
    ...createDefaultProviderForm(),
    id: "primary",
    name: "Primary Provider",
  }));
  const [projectName, setProjectName] = React.useState("");
  const [projectRoot, setProjectRoot] = React.useState("");
  const [projectProviderId, setProjectProviderId] = React.useState("");
  const [telegramEnabled, setTelegramEnabled] = React.useState(false);
  const [telegramToken, setTelegramToken] = React.useState("");
  const [telegramUserIds, setTelegramUserIds] = React.useState("");
  const [restartNotice, setRestartNotice] = React.useState<string | null>(null);
  const providerModelOptions = providerForm.type === "codex-cli" ? [] : getProviderModelOptions(providerForm.type);
  const usingCustomProviderModel = isCustomProviderModel(providerForm);
  const parsedTelegramUserIds = parseTelegramUserIds(telegramUserIds);
  const telegramUserIdIssue = getTelegramUserIdIssue(telegramUserIds);

  React.useEffect(() => {
    if (!projectProviderId && providerData?.providers.length) {
      setProjectProviderId(providerData.providers[0]!.id);
    }
  }, [projectProviderId, providerData]);

  const machineMut = useMutation({
    mutationFn: (body: MachineSetupRequest) => api.onboarding.completeMachine(body),
    onSuccess: (data) => {
      setRestartNotice(data.requiresDaemonRestart ? "Telegram credentials were saved. Restart the daemon once to activate the bot connection." : null);
      void Promise.all([
        qc.invalidateQueries({ queryKey: ["onboarding-state"] }),
        qc.invalidateQueries({ queryKey: ["providers"] }),
        qc.invalidateQueries({ queryKey: ["projects"] }),
        qc.invalidateQueries({ queryKey: ["health"] }),
      ]);
    },
  });

  const canSubmit = (!createProvider || isProviderFormValid(providerForm))
    && (!createProject || Boolean(projectName && projectRoot))
    && (!telegramEnabled || Boolean(telegramToken && parsedTelegramUserIds.length > 0 && !telegramUserIdIssue));

  return (
    <div className="space-y-6 pt-4">
      <Card className="border-feather-700/50 bg-slate-900/70">
        <div className="space-y-3">
          <div className="text-xs uppercase tracking-[0.2em] text-feather-400">Step 1</div>
          <h2 className="text-2xl font-semibold text-white">Machine setup</h2>
          <p className="max-w-3xl text-sm leading-6 text-slate-400">
            Feather needs one enabled provider, at least one registered project, and an explicit Telegram decision so the first run is predictable instead of half-configured.
          </p>
          {restartNotice && <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-4 py-3 text-sm text-yellow-200">{restartNotice}</div>}
          {machineMut.isError && <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">{(machineMut.error as Error).message}</div>}
        </div>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[1.3fr_0.9fr]">
        <div className="space-y-6">
          <Card className="space-y-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold text-white">Provider</h3>
                <p className="mt-1 text-sm text-slate-400">Choose the provider Feather should use first. API keys can be pasted here and stored locally, or you can point at an existing env var.</p>
              </div>
              {!requireProvider && (
                <label className="flex items-center gap-2 text-sm text-slate-300">
                  <input type="checkbox" checked={createProvider} onChange={(e) => setCreateProvider(e.target.checked)} className="rounded border-slate-600 bg-slate-900 text-feather-500" />
                  Add another provider now
                </label>
              )}
            </div>

            {!createProvider && !requireProvider && (
              <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
                Existing providers are already available. You can keep them and move on, or add another one here.
              </div>
            )}

            {createProvider && (
              <div className="grid gap-3 md:grid-cols-2">
                <input value={providerForm.id} onChange={(e) => setProviderForm((current) => ({ ...current, id: e.target.value }))} placeholder="provider id" className="rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white" />
                <input value={providerForm.name} onChange={(e) => setProviderForm((current) => ({ ...current, name: e.target.value }))} placeholder="display name" className="rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white" />
                <select value={providerForm.type} onChange={(e) => setProviderForm((current) => applyProviderTypeDefaults(current, e.target.value as ProviderFormState["type"]))} className="rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white">
                  <option value="codex-cli">codex-cli</option>
                  <option value="openai">openai</option>
                  <option value="openai-compatible">openai-compatible</option>
                  <option value="openrouter">openrouter</option>
                </select>
                {providerForm.type === "codex-cli" ? (
                  <input value={providerForm.command} onChange={(e) => setProviderForm((current) => ({ ...current, command: e.target.value }))} placeholder="codex command" className="rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white" />
                ) : (
                  <div className="rounded border border-slate-700 bg-slate-900/60 p-3 text-sm text-slate-300 md:col-span-2">
                    <div className="font-medium text-white">Credentials</div>
                    <div className="mt-1 text-xs text-slate-400">Paste a key directly and Feather stores it only in `~/.feather/.env.local`, or use an environment variable if you already manage secrets that way.</div>
                    <div className="mt-3 grid gap-2 md:grid-cols-2">
                      <button
                        type="button"
                        onClick={() => setProviderForm((current) => ({ ...current, credentialMode: "local" }))}
                        className={clsx(
                          "rounded border px-3 py-2 text-left text-sm transition-colors",
                          providerForm.credentialMode === "local"
                            ? "border-feather-500 bg-feather-500/10 text-white"
                            : "border-slate-700 bg-slate-950 text-slate-300 hover:border-slate-500",
                        )}
                      >
                        Paste API key directly
                      </button>
                      <button
                        type="button"
                        onClick={() => setProviderForm((current) => ({ ...current, credentialMode: "env", apiKeyValue: "", apiKeyStoredLocally: false }))}
                        className={clsx(
                          "rounded border px-3 py-2 text-left text-sm transition-colors",
                          providerForm.credentialMode === "env"
                            ? "border-feather-500 bg-feather-500/10 text-white"
                            : "border-slate-700 bg-slate-950 text-slate-300 hover:border-slate-500",
                        )}
                      >
                        Use environment variable
                      </button>
                    </div>
                    <div className="mt-3">
                      {providerForm.credentialMode === "local" ? (
                        <input value={providerForm.apiKeyValue} onChange={(e) => setProviderForm((current) => ({ ...current, apiKeyValue: e.target.value }))} type="password" placeholder="Paste API key" className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white" />
                      ) : (
                        <input value={providerForm.apiKeyEnv} onChange={(e) => setProviderForm((current) => ({ ...current, apiKeyEnv: e.target.value }))} placeholder="API key env var" className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white" />
                      )}
                    </div>
                  </div>
                )}
                {providerForm.type === "codex-cli" ? (
                  <div className="space-y-2">
                    <select value={providerForm.mode} onChange={(e) => setProviderForm((current) => ({ ...current, mode: e.target.value as ProviderFormState["mode"] }))} className="w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white">
                      <option value="exec">exec</option>
                      <option value="apply">apply</option>
                    </select>
                    <div className="text-xs text-slate-500">Mode is currently informational only and does not bypass Feather approvals.</div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <select value={usingCustomProviderModel ? "__custom__" : providerForm.model} onChange={(e) => setProviderForm((current) => ({ ...current, model: e.target.value === "__custom__" ? current.model : e.target.value }))} className="w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white">
                      {providerModelOptions.map((option) => (
                        <option key={option} value={option}>{option}</option>
                      ))}
                      <option value="__custom__">Custom...</option>
                    </select>
                    {usingCustomProviderModel && (
                      <input value={providerForm.model} onChange={(e) => setProviderForm((current) => ({ ...current, model: e.target.value }))} placeholder="Custom model name" className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white" />
                    )}
                    <div className="text-xs text-slate-500">Some models require account access. If validation fails, use gpt-4o-mini or Custom. OpenAI-compatible endpoints often need a custom model name.</div>
                  </div>
                )}
                {providerForm.type !== "codex-cli" && (providerForm.type === "openai" || providerForm.type === "openai-compatible") && (
                  <input value={providerForm.baseUrl} onChange={(e) => setProviderForm((current) => ({ ...current, baseUrl: e.target.value }))} placeholder="base URL" className="rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white md:col-span-2" />
                )}
                {providerForm.type !== "codex-cli" && (
                  <>
                    <input value={providerForm.maxTaskCents} onChange={(e) => setProviderForm((current) => ({ ...current, maxTaskCents: e.target.value }))} placeholder="max task cents (optional)" className="rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white md:col-span-2" />
                    <div className="rounded border border-slate-700 bg-slate-900/60 p-3 text-xs text-slate-400 md:col-span-2">
                      <div>Optional pricing for budget estimates.</div>
                      <div>Leave blank if you do not know the provider pricing.</div>
                      <div>Without pricing, Feather can record token usage but cannot enforce hard spend limits.</div>
                    </div>
                    <input value={providerForm.inputCentsPer1MTokens} onChange={(e) => setProviderForm((current) => ({ ...current, inputCentsPer1MTokens: e.target.value }))} placeholder="input cents per 1M tokens (optional)" className="rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white" />
                    <input value={providerForm.outputCentsPer1MTokens} onChange={(e) => setProviderForm((current) => ({ ...current, outputCentsPer1MTokens: e.target.value }))} placeholder="output cents per 1M tokens (optional)" className="rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white" />
                  </>
                )}
              </div>
            )}
          </Card>

          <Card className="space-y-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold text-white">First project</h3>
                <p className="mt-1 text-sm text-slate-400">Register the repo Feather should work on first. You can add more later.</p>
              </div>
              {!requireProject && (
                <label className="flex items-center gap-2 text-sm text-slate-300">
                  <input type="checkbox" checked={createProject} onChange={(e) => setCreateProject(e.target.checked)} className="rounded border-slate-600 bg-slate-900 text-feather-500" />
                  Add another project now
                </label>
              )}
            </div>

            {!createProject && !requireProject && (
              <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
                Existing projects are already registered. You can keep them and move straight to the agent builder.
              </div>
            )}

            {createProject && (
              <div className="grid gap-3 md:grid-cols-2">
                <input value={projectName} onChange={(e) => setProjectName(e.target.value)} placeholder="Project name" className="rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white" />
                <select value={createProvider ? providerForm.id : projectProviderId} onChange={(e) => setProjectProviderId(e.target.value)} className="rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white">
                  <option value="">No coding provider</option>
                  {providerData?.providers.map((provider) => (
                    <option key={provider.id} value={provider.id}>{provider.name}</option>
                  ))}
                  {createProvider && providerForm.id && <option value={providerForm.id}>{providerForm.name || providerForm.id} (new)</option>}
                </select>
                <input value={projectRoot} onChange={(e) => setProjectRoot(e.target.value)} placeholder="Root path, for example C:\\Users\\you\\Projects\\MyApp" className="rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white md:col-span-2" />
              </div>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="space-y-4">
            <div>
              <h3 className="text-lg font-semibold text-white">Telegram</h3>
              <p className="mt-1 text-sm text-slate-400">Optional. If you enable it here, Feather stores the bot token locally and uses numeric Telegram user IDs for approvals.</p>
            </div>

            {state.machine.telegramConfigured && (
              <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
                Telegram credentials are already present. Leave this off to keep the existing config unchanged, or enable it to replace the stored values.
              </div>
            )}

            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input type="checkbox" checked={telegramEnabled} onChange={(e) => setTelegramEnabled(e.target.checked)} className="rounded border-slate-600 bg-slate-900 text-feather-500" />
              Configure Telegram now
            </label>

            {telegramEnabled ? (
              <div className="space-y-3">
                <input value={telegramToken} onChange={(e) => setTelegramToken(e.target.value)} type="password" placeholder="BotFather token" className="w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white" />
                <textarea value={telegramUserIds} onChange={(e) => setTelegramUserIds(e.target.value)} placeholder="Allowed Telegram numeric user IDs, separated by commas or new lines" rows={4} className="w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white" />
                {telegramUserIdIssue && (
                  <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-4 py-3 text-sm text-yellow-200">{telegramUserIdIssue}</div>
                )}
                <div className="rounded-lg border border-slate-700 bg-slate-900/60 px-4 py-3 text-xs text-slate-400">
                  Create the bot with BotFather, send it a message once, then paste the numeric user IDs that are allowed to approve tasks. Do not use `@handles` here.
                </div>
                <button type="button" onClick={() => { setTelegramEnabled(false); setTelegramToken(""); setTelegramUserIds(""); }} className="text-sm text-slate-400 hover:text-white transition-colors">
                  Skip Telegram for now
                </button>
              </div>
            ) : (
              <div className="rounded-lg border border-slate-700 bg-slate-900/60 px-4 py-3 text-sm text-slate-400">
                Telegram will stay off for now. You can add it later from Settings or by editing the global config.
              </div>
            )}
          </Card>

          <Card className="space-y-4 bg-slate-900/70">
            <h3 className="text-lg font-semibold text-white">Complete machine setup</h3>
            <p className="text-sm leading-6 text-slate-400">
              This saves your global config, registers any new provider or project, and records that the first-run machine setup is done.
            </p>
            <button
              disabled={machineMut.isPending || !canSubmit}
              onClick={() => {
                const assignedProviderId = createProvider ? providerForm.id : projectProviderId || providerData?.providers[0]?.id;
                machineMut.mutate({
                  ...(createProvider ? { provider: serializeProviderForm(providerForm) } : {}),
                  ...(createProject
                    ? {
                        project: {
                          name: projectName,
                          rootPath: projectRoot,
                          ...(assignedProviderId ? { codingProviderId: assignedProviderId } : {}),
                        },
                      }
                    : {}),
                  telegram: {
                    enabled: telegramEnabled,
                    ...(telegramEnabled ? { botToken: telegramToken, allowedUserIds: parsedTelegramUserIds } : {}),
                  },
                });
              }}
              className="w-full rounded-lg bg-feather-600 px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-feather-500 disabled:opacity-50"
            >
              {machineMut.isPending ? "Saving machine setup..." : "Continue to agent builder"}
            </button>
          </Card>
        </div>
      </div>
    </div>
  );
}

function AgentBuilderStage({ state }: { state: OnboardingState }) {
  const qc = useQueryClient();
  const questions: Array<{
    key: keyof AgentProfileRequest;
    prompt: string;
    helper: string;
    placeholder: string;
    multiline?: boolean;
  }> = [
    { key: "name", prompt: "What should this agent be called?", helper: "Use the name you want Feather to treat as the default personal agent profile.", placeholder: "For example: Feather Ops" },
    { key: "role", prompt: "What role should it play for you?", helper: "Describe the kind of assistant this is in one line.", placeholder: "For example: Senior engineering copilot for product and code work" },
    { key: "mission", prompt: "What is its main mission?", helper: "This becomes the core objective the agent should optimise for.", placeholder: "Help me ship reliable product changes with minimal wasted effort.", multiline: true },
    { key: "tone", prompt: "How should it communicate with you?", helper: "Keep this concrete: terse, detailed, challenging, supportive, etc.", placeholder: "Direct, technical, concise, and willing to challenge weak assumptions." },
    { key: "autonomy", prompt: "How far should it go on its own before asking?", helper: "State the level of initiative you want, and when it must stop for approval.", placeholder: "Push through routine implementation and tests, but stop before destructive actions or secret changes.", multiline: true },
    { key: "boundaries", prompt: "What boundaries should it never cross?", helper: "Use one line per rule if you want multiple entries.", placeholder: "Never deploy without approval\nNever edit env files without approval\nNever hide failing tests", multiline: true },
    { key: "workflow", prompt: "What workflow preferences should it follow every time?", helper: "These are the repeatable habits you want baked into its default behaviour.", placeholder: "Start from the concrete failing surface\nPrefer small reversible edits\nRun focused validation before widening scope", multiline: true },
    { key: "reporting", prompt: "How should it report progress and close out work?", helper: "Think update cadence, level of detail, and what should always be surfaced.", placeholder: "Frequent short progress updates, then a concise close-out covering results, validation, and remaining risks.", multiline: true },
  ];

  const [answers, setAnswers] = React.useState<Partial<Record<keyof AgentProfileRequest, string>>>({});
  const [draft, setDraft] = React.useState("");
  const currentIndex = questions.findIndex((question) => !answers[question.key]);
  const currentQuestion = currentIndex === -1 ? null : questions[currentIndex]!;

  const saveAgentMut = useMutation({
    mutationFn: (body: AgentProfileRequest) => api.onboarding.completeAgent(body),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["onboarding-state"] });
    },
  });

  const messages: Array<{ role: "assistant" | "user"; content: string; helper: string }> = questions.flatMap((question) => {
    const answer = answers[question.key];
    return answer
      ? [
          { role: "assistant" as const, content: question.prompt, helper: question.helper },
          { role: "user" as const, content: answer, helper: "" },
        ]
      : [{ role: "assistant" as const, content: question.prompt, helper: question.helper }];
  }).slice(0, currentQuestion ? currentIndex * 2 + 1 : undefined);

  return (
    <div className="space-y-6 pt-4">
      <Card className="border-feather-700/50 bg-slate-900/70">
        <div className="space-y-3">
          <div className="text-xs uppercase tracking-[0.2em] text-feather-400">Step 2</div>
          <h2 className="text-2xl font-semibold text-white">Build the global agent profile</h2>
          <p className="max-w-3xl text-sm leading-6 text-slate-400">
            This is the default identity every Feather task will inherit before project instructions and repo-local guidance are layered on top.
          </p>
          <div className="rounded-lg border border-slate-700 bg-slate-900/60 px-4 py-3 text-sm text-slate-400">
            The builder writes to {state.paths.globalAgentFilePath}. Project-specific instructions still live in each repo under .feather/instructions.md.
          </div>
        </div>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[1.25fr_0.75fr]">
        <Card className="space-y-4">
          <div className="space-y-3">
            {messages.map((message, index) => (
              <div key={`${message.role}-${index}`} className={clsx("rounded-2xl px-4 py-3", message.role === "assistant" ? "mr-12 border border-slate-700 bg-slate-900/80" : "ml-12 bg-feather-600 text-white") }>
                <div className={clsx("text-xs uppercase tracking-[0.18em]", message.role === "assistant" ? "text-slate-500" : "text-feather-100/80")}>{message.role === "assistant" ? "Feather" : "You"}</div>
                <div className="mt-2 text-sm leading-6">{message.content}</div>
                {message.helper && <div className="mt-2 text-xs text-slate-500">{message.helper}</div>}
              </div>
            ))}
          </div>

          {currentQuestion ? (
            <div className="space-y-3 rounded-2xl border border-feather-700/40 bg-feather-500/5 p-4">
              <div>
                <div className="text-sm font-semibold text-white">{currentQuestion.prompt}</div>
                <div className="mt-1 text-xs text-slate-400">{currentQuestion.helper}</div>
              </div>
              {currentQuestion.multiline ? (
                <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={6} placeholder={currentQuestion.placeholder} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white" />
              ) : (
                <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={currentQuestion.placeholder} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white" />
              )}
              <div className="flex justify-end">
                <button
                  disabled={!draft.trim()}
                  onClick={() => {
                    setAnswers((current) => ({ ...current, [currentQuestion.key]: draft.trim() }));
                    setDraft("");
                  }}
                  className="rounded-lg bg-feather-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-feather-500 disabled:opacity-50"
                >
                  Save answer
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-4 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4">
              <div>
                <div className="text-lg font-semibold text-white">Profile ready to write</div>
                <div className="mt-1 text-sm text-emerald-100/80">Review the summary, then save the global agent profile.</div>
              </div>
              {saveAgentMut.isError && <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">{(saveAgentMut.error as Error).message}</div>}
              <button
                disabled={saveAgentMut.isPending}
                onClick={() => saveAgentMut.mutate({
                  name: answers.name ?? "Feather Agent",
                  role: answers.role ?? "Personal software agent",
                  mission: answers.mission ?? "Ship reliable work with minimal overhead.",
                  tone: answers.tone ?? "Direct and concise.",
                  autonomy: answers.autonomy ?? "Work independently until approval is required.",
                  boundaries: answers.boundaries ?? "",
                  workflow: answers.workflow ?? "",
                  reporting: answers.reporting ?? "Summarise results, validation, and remaining risks.",
                })}
                className="rounded-lg bg-feather-600 px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-feather-500 disabled:opacity-50"
              >
                {saveAgentMut.isPending ? "Writing agent profile..." : "Write global agent file and finish"}
              </button>
            </div>
          )}
        </Card>

        <Card className="space-y-4 bg-slate-900/70">
          <h3 className="text-lg font-semibold text-white">Profile summary</h3>
          <div className="space-y-3 text-sm text-slate-300">
            {questions.map((question) => (
              <div key={question.key} className="rounded-lg border border-slate-700 bg-slate-900/60 px-4 py-3">
                <div className="text-xs uppercase tracking-[0.18em] text-slate-500">{question.key}</div>
                <div className="mt-2 whitespace-pre-wrap text-sm text-white">{answers[question.key] || "Waiting for your answer..."}</div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

function parseTelegramUserIds(value: string): number[] {
  return value
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => Number.parseInt(entry, 10))
    .filter((entry) => !Number.isNaN(entry));
}

function getTelegramUserIdIssue(value: string): string | null {
  const entries = value
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (entries.some((entry) => entry.startsWith("@"))) {
    return "Telegram approvals require numeric user IDs, not @handles.";
  }

  if (entries.some((entry) => !/^\d+$/.test(entry))) {
    return "Every Telegram entry must be a numeric user ID.";
  }

  return null;
}

// ── App ───────────────────────────────────────────────────────────────────────
export default function App() {
  const { data: onboardingData, isLoading, isError, error } = useQuery({
    queryKey: ["onboarding-state"],
    queryFn: api.onboarding.state,
    refetchInterval: 10000,
  });

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-100">
        <div className="text-sm text-slate-400">Loading Feather...</div>
      </div>
    );
  }

  if (isError || !onboardingData) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 px-6 text-slate-100">
        <Card className="max-w-xl border-red-500/30 bg-red-500/10">
          <div className="text-lg font-semibold text-white">Could not load onboarding state</div>
          <div className="mt-2 text-sm leading-6 text-red-100/80">
            {error instanceof Error ? error.message : "Unknown error"}
          </div>
          <div className="mt-4 rounded-lg border border-red-500/20 bg-slate-950/40 px-4 py-3 text-sm text-slate-200">
            Start the Feather daemon, then refresh this page. If you are running the dashboard through Vite, point it at the daemon with `VITE_FEATHER_API_BASE_URL` when needed.
          </div>
        </Card>
      </div>
    );
  }

  if (onboardingData.state.stage !== "complete") {
    return <OnboardingFlow state={onboardingData.state} />;
  }

  return (
    <div className="flex h-screen overflow-hidden bg-slate-950 text-slate-100">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/projects" element={<ProjectsPage />} />
          <Route path="/tasks" element={<TasksPage />} />
          <Route path="/approvals" element={<ApprovalsPage />} />
          <Route path="/heartbeat" element={<HeartbeatPage />} />
          <Route path="/memory" element={<MemoryPage />} />
          <Route path="/skills" element={<SkillsPage />} />
          <Route path="/providers" element={<ProvidersPage />} />
          <Route path="/budgets" element={<BudgetsPage />} />
          <Route path="/logs" element={<LogsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </main>
    </div>
  );
}
