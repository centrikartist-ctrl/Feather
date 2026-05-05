import fs from "node:fs";
import path from "node:path";
import { getFeatherHomeDir } from "../config/index.js";

const LOCAL_SECRETS_FILE = ".env.local";

type EnvLine =
  | { type: "entry"; key: string; value: string }
  | { type: "other"; raw: string };

export function getFeatherLocalSecretsPath(): string {
  return path.join(getFeatherHomeDir(), LOCAL_SECRETS_FILE);
}

export function deriveProviderLocalApiKeyEnvName(providerType: string, providerId: string): string {
  return `FEATHER_${normalizeEnvSegment(providerType)}_${normalizeEnvSegment(providerId)}_API_KEY`;
}

export function loadFeatherLocalSecrets(): Record<string, string> {
  const filePath = getFeatherLocalSecretsPath();
  if (!fs.existsSync(filePath)) {
    return {};
  }

  const result: Record<string, string> = {};
  for (const line of parseEnvLines(fs.readFileSync(filePath, "utf8"))) {
    if (line.type === "entry") {
      result[line.key] = line.value;
    }
  }
  return result;
}

export function loadFeatherLocalSecretsIntoProcess(): string[] {
  const secrets = loadFeatherLocalSecrets();
  const loaded: string[] = [];

  for (const [key, value] of Object.entries(secrets)) {
    if (process.env[key] === undefined) {
      process.env[key] = value;
      loaded.push(key);
    }
  }

  return loaded;
}

export function upsertFeatherLocalSecret(key: string, value: string): void {
  const filePath = getFeatherLocalSecretsPath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  const parsed = fs.existsSync(filePath)
    ? parseEnvLines(fs.readFileSync(filePath, "utf8"))
    : [];

  const nextLines: string[] = [];
  let replaced = false;

  for (const line of parsed) {
    if (line.type === "entry" && line.key === key) {
      if (!replaced) {
        nextLines.push(formatEnvEntry(key, value));
        replaced = true;
      }
      continue;
    }

    nextLines.push(line.type === "entry" ? formatEnvEntry(line.key, line.value) : line.raw);
  }

  if (!replaced) {
    nextLines.push(formatEnvEntry(key, value));
  }

  fs.writeFileSync(filePath, `${nextLines.join("\n").replace(/\n*$/, "")}\n`, "utf8");
  process.env[key] = value;
}

function parseEnvLines(content: string): EnvLine[] {
  return content.split(/\r?\n/).map((raw) => {
    const match = raw.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) {
      return { type: "other", raw };
    }

    return {
      type: "entry",
      key: match[1]!,
      value: parseEnvValue(match[2] ?? ""),
    };
  });
}

function parseEnvValue(rawValue: string): string {
  const trimmed = rawValue.trim();
  if ((trimmed.startsWith("\"") && trimmed.endsWith("\"")) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    const quote = trimmed[0];
    const inner = trimmed.slice(1, -1);
    if (quote === "\"") {
      try {
        return JSON.parse(trimmed);
      } catch {
        return inner;
      }
    }

    return inner;
  }

  return trimmed;
}

function formatEnvEntry(key: string, value: string): string {
  return `${key}=${JSON.stringify(value)}`;
}

function normalizeEnvSegment(value: string): string {
  const normalized = value
    .trim()
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();

  return normalized || "DEFAULT";
}