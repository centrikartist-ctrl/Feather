import { ValidationError } from "@feather/shared";
import type { ProviderRegistry } from "./registry.js";
import type { ProjectService } from "../projects/index.js";

export async function resolveTaskProviderId(options: {
  requestedProviderId?: string;
  projectId?: string;
  globalDefaultProviderId?: string;
  allowSingleProviderAutoRoute?: boolean;
  /** @deprecated Use globalDefaultProviderId. Kept for backwards compatibility. */
  fallbackProviderId?: string;
  projects: ProjectService;
  providers: ProviderRegistry;
}): Promise<string> {
  const {
    requestedProviderId,
    projectId,
    globalDefaultProviderId,
    allowSingleProviderAutoRoute = false,
    fallbackProviderId,
    projects,
    providers,
  } = options;

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

  const explicitGlobalDefaultProviderId = globalDefaultProviderId ?? fallbackProviderId;
  if (explicitGlobalDefaultProviderId) {
    ensureProviderExists(
      providers,
      explicitGlobalDefaultProviderId,
      `Global default provider is not configured: ${explicitGlobalDefaultProviderId}`,
    );
    return explicitGlobalDefaultProviderId;
  }

  const configuredProviders = providers.list();
  if (allowSingleProviderAutoRoute && configuredProviders.length === 1) {
    return configuredProviders[0]!.id;
  }

  if (configuredProviders.length === 0) {
    throw new ValidationError("No provider configured. Add a provider first.");
  }

  throw new ValidationError(
    projectId
      ? "No provider selected for this project. Set project coding/default provider, set providers.globalDefaultProviderId, pass a task provider explicitly, or enable providers.allowSingleProviderAutoRoute."
      : "No provider selected. Pass a task provider explicitly, set providers.globalDefaultProviderId, or enable providers.allowSingleProviderAutoRoute.",
  );
}

function ensureProviderExists(providers: ProviderRegistry, providerId: string, message: string): void {
  const exists = providers.list().some((provider) => provider.id === providerId);
  if (!exists) {
    throw new ValidationError(message);
  }
}
