import path from "node:path";
import fs from "node:fs";
import micromatch from "micromatch";
import {
  SECRET_DENY_PATTERNS,
  SHELL_DENY_PATTERNS,
  ALWAYS_BLOCKED_PATHS,
  PermissionDeniedError,
} from "@feather/shared";
import type { RiskLevel } from "@feather/shared";
import type { ProjectFileConfig } from "../config/index.js";

export type PathCheckResult = {
  allowed: boolean;
  risk: RiskLevel;
  reason?: string;
};

export type ShellCheckResult = {
  allowed: boolean;
  requiresApproval: boolean;
  risk: RiskLevel;
  reason?: string;
};

export class PermissionService {
  constructor(
    private readonly projectRoot: string,
    private readonly config: ProjectFileConfig | null,
  ) {}

  checkFilesystemRead(filePath: string): PathCheckResult {
    const resolved = this.resolveSafePath(filePath);
    if (!resolved.ok) {
      return { allowed: false, risk: "blocked", reason: resolved.reason };
    }

    if (this.matchesSecretPattern(resolved.relativePath)) {
      return { allowed: false, risk: "blocked", reason: "Matches secret deny pattern" };
    }

    if (this.matchesAlwaysBlocked(resolved.relativePath)) {
      return { allowed: false, risk: "blocked", reason: "Path is always blocked" };
    }

    const denyList = this.config?.permissions?.filesystem?.deny ?? [];
    if (this.matchesPatterns(resolved.relativePath, denyList)) {
      return { allowed: false, risk: "blocked", reason: "Matches filesystem deny list" };
    }

    return { allowed: true, risk: "safe" };
  }

  checkFilesystemWrite(filePath: string): PathCheckResult {
    const resolved = this.resolveSafePath(filePath);
    if (!resolved.ok) {
      return { allowed: false, risk: "blocked", reason: resolved.reason };
    }

    if (this.matchesSecretPattern(resolved.relativePath)) {
      return { allowed: false, risk: "blocked", reason: "Matches secret deny pattern" };
    }

    if (this.matchesAlwaysBlocked(resolved.relativePath)) {
      return { allowed: false, risk: "blocked", reason: "Path is always blocked" };
    }

    const denyList = this.config?.permissions?.filesystem?.deny ?? [];
    if (this.matchesPatterns(resolved.relativePath, denyList)) {
      return { allowed: false, risk: "blocked", reason: "Matches filesystem deny list" };
    }

    const writeList = this.config?.permissions?.filesystem?.write ?? [];
    if (writeList.length > 0 && !this.matchesPatterns(resolved.relativePath, writeList)) {
      return { allowed: false, risk: "review", reason: "Path not in write allowlist — approval required" };
    }

    return { allowed: true, risk: writeList.length > 0 ? "safe" : "review" };
  }

  checkShellCommand(command: string): ShellCheckResult {
    // Always block dangerous shell patterns
    if (this.matchesShellDenyPattern(command)) {
      return { allowed: false, requiresApproval: false, risk: "blocked", reason: "Matches shell deny pattern" };
    }

    const denyList = this.config?.permissions?.shell?.deny ?? [];
    if (this.matchesGlob(command, denyList)) {
      return { allowed: false, requiresApproval: false, risk: "blocked", reason: "Matches project shell deny list" };
    }

    const allowList = this.config?.permissions?.shell?.allow ?? [];
    if (this.matchesGlob(command, allowList)) {
      return { allowed: true, requiresApproval: false, risk: "safe" };
    }

    const reviewList = this.config?.permissions?.shell?.require_approval ?? [];
    if (this.matchesGlob(command, reviewList)) {
      return { allowed: true, requiresApproval: true, risk: "review" };
    }

    // Not explicitly allowed — require approval
    return { allowed: true, requiresApproval: true, risk: "review", reason: "Command not on allow list" };
  }

  assertFilesystemRead(filePath: string): void {
    const result = this.checkFilesystemRead(filePath);
    if (!result.allowed) {
      throw new PermissionDeniedError("filesystem:read", result.reason ?? "denied");
    }
  }

  assertFilesystemWrite(filePath: string): void {
    const result = this.checkFilesystemWrite(filePath);
    if (!result.allowed && result.risk === "blocked") {
      throw new PermissionDeniedError("filesystem:write", result.reason ?? "denied");
    }
  }

  private resolveSafePath(filePath: string): { ok: true; resolved: string; relativePath: string } | { ok: false; reason: string } {
    let resolved: string;
    try {
      resolved = path.resolve(this.projectRoot, filePath);
    } catch {
      return { ok: false, reason: "Invalid path" };
    }

    // Prevent path traversal outside project root
    if (!resolved.startsWith(this.projectRoot + path.sep) && resolved !== this.projectRoot) {
      return { ok: false, reason: "Path traversal outside project root" };
    }

    const relativePath = path.relative(this.projectRoot, resolved);
    return { ok: true, resolved, relativePath };
  }

  private matchesSecretPattern(relativePath: string): boolean {
    const basename = path.basename(relativePath);
    return micromatch.isMatch(basename, SECRET_DENY_PATTERNS) || micromatch.isMatch(relativePath, SECRET_DENY_PATTERNS);
  }

  private matchesAlwaysBlocked(relativePath: string): boolean {
    const parts = relativePath.split(path.sep);
    return parts.some((part) => ALWAYS_BLOCKED_PATHS.includes(part));
  }

  private matchesPatterns(relativePath: string, patterns: string[]): boolean {
    if (patterns.length === 0) return false;
    return patterns.some((pattern) => {
      const normalizedPattern = pattern.replaceAll("/", path.sep).replace(/[\\/]+$/, "");
      const normalizedRelativePath = relativePath.replaceAll("/", path.sep);

      if (micromatch.isMatch(normalizedRelativePath, pattern) || micromatch.isMatch(path.basename(normalizedRelativePath), pattern)) {
        return true;
      }

      if (!pattern.includes("*") && !pattern.includes("?")) {
        return normalizedRelativePath === normalizedPattern || normalizedRelativePath.startsWith(`${normalizedPattern}${path.sep}`);
      }

      return false;
    });
  }

  private matchesShellDenyPattern(command: string): boolean {
    return SHELL_DENY_PATTERNS.some((pattern) => {
      const regexPattern = pattern.replace(/\*/g, ".*").replace(/\?/g, ".");
      return new RegExp(`^${regexPattern}`, "i").test(command.trim());
    });
  }

  private matchesGlob(command: string, patterns: string[]): boolean {
    if (patterns.length === 0) return false;
    return patterns.some((pattern) => {
      const regexPattern = pattern.replace(/\*/g, ".*").replace(/\?/g, ".");
      return new RegExp(`^${regexPattern}$`, "i").test(command.trim());
    });
  }
}
