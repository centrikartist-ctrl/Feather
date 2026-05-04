export class FeatherError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number = 500,
  ) {
    super(message);
    this.name = "FeatherError";
  }
}

export class NotFoundError extends FeatherError {
  constructor(resource: string, id: string) {
    super(`${resource} not found: ${id}`, "NOT_FOUND", 404);
    this.name = "NotFoundError";
  }
}

export class ValidationError extends FeatherError {
  constructor(message: string) {
    super(message, "VALIDATION_ERROR", 400);
    this.name = "ValidationError";
  }
}

export class PermissionDeniedError extends FeatherError {
  constructor(scope: string, reason: string) {
    super(`Permission denied for ${scope}: ${reason}`, "PERMISSION_DENIED", 403);
    this.name = "PermissionDeniedError";
  }
}

export class ApprovalRequiredError extends FeatherError {
  constructor(
    public readonly approvalId: string,
    action: string,
  ) {
    super(`Approval required for: ${action}`, "APPROVAL_REQUIRED", 202);
    this.name = "ApprovalRequiredError";
  }
}

export class BudgetExceededError extends FeatherError {
  constructor(scope: string, limitCents: number) {
    super(
      `Budget exceeded for ${scope}: limit is ${limitCents} cents`,
      "BUDGET_EXCEEDED",
      402,
    );
    this.name = "BudgetExceededError";
  }
}

export class ProviderError extends FeatherError {
  constructor(providerId: string, message: string) {
    super(`Provider ${providerId} error: ${message}`, "PROVIDER_ERROR", 502);
    this.name = "ProviderError";
  }
}

export class PanicModeError extends FeatherError {
  constructor() {
    super("Feather is in panic mode. Operations are suspended.", "PANIC_MODE", 503);
    this.name = "PanicModeError";
  }
}
