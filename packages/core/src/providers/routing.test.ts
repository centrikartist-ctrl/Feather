import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDb, initDb } from "../db/index.js";
import { ProjectService } from "../projects/index.js";
import { ProviderRegistry } from "./registry.js";
import { resolveTaskProviderId } from "./routing.js";

let tempDir: string;
let projects: ProjectService;
let providers: ProviderRegistry;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "feather-routing-test-"));
  initDb(path.join(tempDir, "test.db"));
  projects = new ProjectService();
  providers = new ProviderRegistry();
});

afterEach(() => {
  closeDb();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("resolveTaskProviderId", () => {
  it("prefers explicit task override, then project provider", async () => {
    const projectRoot = path.join(tempDir, "project");
    fs.mkdirSync(projectRoot, { recursive: true });
    const project = await projects.addProject({ name: "routing-project", rootPath: projectRoot });

    await projects.updateProject(project.id, { codingProviderId: "project-provider" });
    await providers.register(providers.fromConfig({ id: "project-provider", type: "codex-cli" }));
    await providers.register(providers.fromConfig({ id: "override-provider", type: "codex-cli" }));

    await expect(resolveTaskProviderId({
      requestedProviderId: "override-provider",
      projectId: project.id,
      projects,
      providers,
    })).resolves.toBe("override-provider");

    await expect(resolveTaskProviderId({
      projectId: project.id,
      projects,
      providers,
    })).resolves.toBe("project-provider");
  });

  it("fails clearly when multiple providers are configured and no route is specified", async () => {
    providers.register(providers.fromConfig({ id: "one", type: "codex-cli" }));
    providers.register(providers.fromConfig({ id: "two", type: "codex-cli" }));

    await expect(resolveTaskProviderId({ projects, providers })).rejects.toThrow(/globalDefaultProviderId|allowSingleProviderAutoRoute/);
  });

  it("uses explicit global default provider when project is not pinned", async () => {
    providers.register(providers.fromConfig({ id: "global-default", type: "codex-cli" }));
    providers.register(providers.fromConfig({ id: "other", type: "codex-cli" }));

    await expect(resolveTaskProviderId({
      globalDefaultProviderId: "global-default",
      projects,
      providers,
    })).resolves.toBe("global-default");
  });

  it("does not silently route to a single provider unless auto-route is enabled", async () => {
    providers.register(providers.fromConfig({ id: "only-provider", type: "codex-cli" }));

    await expect(resolveTaskProviderId({
      projects,
      providers,
    })).rejects.toThrow(/providers\.globalDefaultProviderId|allowSingleProviderAutoRoute/);

    await expect(resolveTaskProviderId({
      allowSingleProviderAutoRoute: true,
      projects,
      providers,
    })).resolves.toBe("only-provider");
  });
});