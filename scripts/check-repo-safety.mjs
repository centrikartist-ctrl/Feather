import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const trackedFiles = execFileSync("git", ["ls-files", "-z"], {
  encoding: "utf8",
})
  .split("\0")
  .filter(Boolean)
  .map((filePath) => filePath.replace(/\\/g, "/"));

const violations = trackedFiles.filter((filePath) => isForbiddenPath(filePath));
const dangerousFlagViolations = trackedFiles.flatMap((filePath) => findDangerousFlagViolations(filePath));

if (violations.length > 0 || dangerousFlagViolations.length > 0) {
  console.error("Tracked credentials or local build spec files are not allowed:");
  for (const filePath of violations) {
    console.error(` - ${filePath}`);
  }
  for (const violation of dangerousFlagViolations) {
    console.error(` - ${violation.filePath}: ${violation.flag}`);
  }
  process.exit(1);
}

console.log("Repo safety guard passed.");

function isForbiddenPath(filePath) {
  if (filePath === ".env.example") {
    return false;
  }

  const normalized = filePath.toLowerCase();

  if (normalized === ".env" || (normalized.startsWith(".env.") && normalized !== ".env.example")) {
    return true;
  }

  if (/^.*\/(?:\.env|\.env\..+)$/.test(normalized)) {
    return !normalized.endsWith("/.env.example");
  }

  if (/(^|\/)(credentials|secrets)\.[^/]+$/.test(normalized)) {
    return true;
  }

  if (/(^|\/)(id_rsa|id_ed25519)$/.test(normalized)) {
    return true;
  }

  if (/\.(pem|key|p12|pfx)$/.test(normalized)) {
    return true;
  }

  if (/(^|\/)feather[-_].*(pass|plan|spec).*\.md$/.test(normalized)) {
    return true;
  }

  if (normalized === "feather_product_spec_updated.docx") {
    return true;
  }

  if (/^(logs|snapshots|tmp)\//.test(normalized) || /(^|\/)(logs|snapshots|tmp)\//.test(normalized)) {
    return true;
  }

  if (/\.(log|db|db-shm|db-wal)$/.test(normalized)) {
    return true;
  }

  return false;
}

function findDangerousFlagViolations(filePath) {
  if (filePath === "scripts/check-repo-safety.mjs") {
    return [];
  }
  if (/\.(test|spec)\.(ts|tsx|js|jsx)$/.test(filePath.toLowerCase())) {
    return [];
  }
  if (!isTextFile(filePath)) {
    return [];
  }

  let content;
  try {
    content = readFileSync(filePath, "utf8");
  } catch {
    return [];
  }

  const forbiddenFlags = [
    "--dangerously-auto-approve-everything",
    "--full-auto",
    "--auto-approve",
    "--bypass-approval",
    "--skip-approval",
  ];

  const violations = [];
  const lines = content.split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    const normalizedLine = line.toLowerCase();
    if (normalizedLine.includes("never emitted") || normalizedLine.includes("not emitted")) {
      continue;
    }
    for (const flag of forbiddenFlags) {
      if (line.includes(flag)) {
        violations.push({ filePath, flag: `${flag} on line ${index + 1}` });
      }
    }
  }
  return violations;
}

function isTextFile(filePath) {
  return /\.(cjs|css|html|js|json|jsx|md|mjs|ts|tsx|txt|yaml|yml)$/.test(filePath.toLowerCase());
}
