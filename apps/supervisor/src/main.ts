#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadSupervisorConfig } from "./config.js";
import { FeatherSupervisor } from "./supervisor.js";

const repoRoot = path.resolve(fileURLToPath(new URL("../../../", import.meta.url)));
const config = loadSupervisorConfig();
const supervisor = new FeatherSupervisor(config, repoRoot);

const command = process.argv[2] ?? "run";

if (command === "run") {
  await supervisor.run();
} else if (command === "status") {
  const state = await supervisor.tick();
  console.log(JSON.stringify(state, null, 2));
} else if (command === "snapshot" && process.argv[3] === "create") {
  const reason = process.argv.slice(4).join(" ") || "manual snapshot";
  const snapshot = supervisor.createSnapshot(reason);
  console.log(JSON.stringify(snapshot, null, 2));
  if (!snapshot.ok) {
    process.exitCode = 1;
  }
} else {
  console.error("Usage: feather-supervisor run | status | snapshot create [reason]");
  process.exitCode = 1;
}
