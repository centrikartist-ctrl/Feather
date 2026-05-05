import { execFileSync } from "node:child_process";

const trackedFiles = execFileSync("git", ["ls-files", "-z"], {
  encoding: "utf8",
})
  .split("\0")
  .filter(Boolean)
  .map((filePath) => filePath.replace(/\\/g, "/"));

const violations = trackedFiles.filter((filePath) => isForbiddenPath(filePath));

if (violations.length > 0) {
  console.error("Tracked credentials or local build spec files are not allowed:");
  for (const filePath of violations) {
    console.error(` - ${filePath}`);
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

  if (/(^|\/)feather_.*(pass|plan|spec).*\.md$/.test(normalized)) {
    return true;
  }

  if (normalized === "feather_product_spec_updated.docx") {
    return true;
  }

  return false;
}