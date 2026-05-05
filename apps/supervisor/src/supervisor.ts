import { spawn } from "node:child_process";
import pino from "pino";
import { readGuardLocks, upsertGuardLock } from "@feather/core";
import type { SupervisorConfig } from "./config.js";
import { classifyHealth, pollGatewayHealth, type HealthClassification } from "./health.js";
import { createSnapshot } from "./snapshot.js";

export type SupervisorState = {
  classification: HealthClassification;
  consecutiveFailures: number;
  restartAttempts: number;
};

export class FeatherSupervisor {
  private state: SupervisorState = {
    classification: "unreachable",
    consecutiveFailures: 0,
    restartAttempts: 0,
  };
  private stopped = false;
  private readonly logger = pino({ name: "feather-supervisor" });

  constructor(
    private readonly config: SupervisorConfig,
    private readonly repoRoot: string,
  ) {}

  getState(): SupervisorState {
    return { ...this.state };
  }

  async tick(): Promise<SupervisorState> {
    const locks = readGuardLocks();
    if (locks["panic.lock"].active) {
      this.state = { ...this.state, classification: "critical" };
      this.logger.warn("Panic lock active. Supervisor will not restart or update the gateway.");
      return this.getState();
    }

    const result = await pollGatewayHealth(
      this.config.gatewayUrl,
      this.config.requestTimeoutMs,
      this.state.classification !== "healthy",
    );
    const classification = classifyHealth(result);
    const failed = classification === "unreachable" || classification === "critical";
    this.state = {
      ...this.state,
      classification,
      consecutiveFailures: failed ? this.state.consecutiveFailures + 1 : 0,
    };

    if (classification === "unreachable" && this.state.consecutiveFailures >= this.config.restartFailureThreshold) {
      this.restartGateway();
    }

    if (failed && this.state.consecutiveFailures >= this.config.safeModeFailureThreshold) {
      this.enterSafeMode(`Gateway remained ${classification} for ${this.state.consecutiveFailures} supervisor ticks.`);
    }

    return this.getState();
  }

  async run(): Promise<void> {
    this.logger.info({ gatewayUrl: this.config.gatewayUrl }, "Feather supervisor started");
    while (!this.stopped) {
      await this.tick().catch((error: unknown) => {
        this.logger.error({ error }, "Supervisor tick failed");
      });
      await sleep(this.config.pollIntervalMs);
    }
  }

  stop(): void {
    this.stopped = true;
  }

  createSnapshot(reason: string) {
    return createSnapshot({
      featherHomeDir: this.config.featherHomeDir,
      repoRoot: this.repoRoot,
      snapshotsDir: this.config.snapshotsDir,
      reason,
    });
  }

  private restartGateway(): void {
    if (!this.config.restart.enabled || !this.config.restart.command) {
      this.logger.warn("Gateway restart requested by health policy, but restart is not configured.");
      return;
    }

    this.state.restartAttempts += 1;
    this.logger.warn({ attempt: this.state.restartAttempts }, "Attempting configured gateway restart");
    spawn(this.config.restart.command, this.config.restart.args, {
      cwd: this.config.restart.cwd,
      detached: true,
      stdio: "ignore",
      shell: false,
      windowsHide: true,
    }).unref();
  }

  private enterSafeMode(reason: string): void {
    const lock = upsertGuardLock("safe-mode.lock", reason);
    this.createSnapshot(`safe-mode: ${reason}`);
    this.logger.error({ lockPath: lock.path, reason }, "Feather entered safe mode");
    this.state = { ...this.state, classification: "safe_mode" };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
