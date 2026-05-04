import { startDaemon } from "./daemon.js";

void startDaemon().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});