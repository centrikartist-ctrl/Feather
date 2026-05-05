export const FEATHER_TOOL_NAMES = [
  "filesystem.readFile",
  "filesystem.listFiles",
  "filesystem.writeFile",
  "shell.run",
  "shell.runCommand",
  "git.status",
  "git.diff",
  "git.log",
] as const;

export type FeatherToolName = (typeof FEATHER_TOOL_NAMES)[number];