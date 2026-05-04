import { ValidationError } from "@feather/shared";
import type { ProviderRegistry } from "./registry.js";
import type { ProjectService } from "../projects/index.js";

export async function resolveTaskProviderId(options: {
  requestedProviderId?: string;
  projectId?: string;
  fallbackProviderId?: string;
  projects: ProjectService;
  providers: ProviderRegistry;
}): Promise<string> {
  const { requestedProviderId, projectId, fallbackProviderId, projects, providers } = options;

  if (requestedProviderId) {
    ensureProviderExists(providers, requestedProviderId, `Requested provider is not configured: ${requestedProviderId}`);
    return requestedProviderId;
  }

  if (projectId) {
    const project = await projects.getProject(projectId);
    const projectProviderId = project.codingProviderId ?? project.defaultProviderId;
    if (projectProviderId) {
      ensureProviderExists(
        providers,
        projectProviderId,
        `Project ${project.name} is assigned to missing provider: ${projectProviderId}`,
      );
      return projectProviderId;
    }
  }

  if (fallbackProviderId) {
    ensureProviderExists(providers, fallbackProviderId, `Fallback provider is not configured: ${fallbackProviderId}`);
    return fallbackProviderId;
  }

  const configuredProviders = providers.list();
  if (configuredProviders.length === 1) {
    return configuredProviders[0]!.id;
  }

  if (configuredProviders.length === 0) {
    throw new ValidationError("No provider configured. Add a provider first.");
  }

  throw new ValidationError(
    projectId
      ? "No provider selected for this project. Set a coding provider on the project or pass a task provider explicitly."
      : "Multiple providers are configured. Select a provider explicitly for this task.",
  );
}

function ensureProviderExists(providers: ProviderRegistry, providerId: string, message: string): void {
  const exists = providers.list().some((provider) => provider.id === providerId);
  if (!exists) {
    throw new ValidationError(message);
  }
}
