import { desc, eq } from "drizzle-orm";
import { getDb } from "../db/index.js";
import { providerConfigs } from "../db/schema.js";
import type { ProviderConfigEntry, ProviderRegistry } from "./registry.js";

export type StoredProviderConfig = {
  id: string;
  name: string;
  type: ProviderConfigEntry["type"];
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  config: Omit<ProviderConfigEntry, "id" | "type">;
};

export type UpsertProviderConfigInput = {
  id: string;
  name: string;
  type: ProviderConfigEntry["type"];
  enabled?: boolean;
  config: Omit<ProviderConfigEntry, "id" | "type">;
};

export class ProviderConfigService {
  constructor(private readonly registry: ProviderRegistry) {}

  async loadIntoRegistry(): Promise<void> {
    this.registry.clear();

    const configs = await this.list();
    for (const config of configs) {
      if (!config.enabled) continue;
      const provider = this.registry.fromConfig({
        id: config.id,
        type: config.type,
        ...config.config,
      } as ProviderConfigEntry);
      this.registry.register(provider);
    }
  }

  async list(): Promise<StoredProviderConfig[]> {
    const db = getDb();
    const rows = await db.select().from(providerConfigs).orderBy(desc(providerConfigs.updatedAt));

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      type: row.type as ProviderConfigEntry["type"],
      enabled: row.enabled,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      config: JSON.parse(row.configJson) as Omit<ProviderConfigEntry, "id" | "type">,
    }));
  }

  async upsert(input: UpsertProviderConfigInput): Promise<StoredProviderConfig> {
    const db = getDb();
    const existing = await db.select().from(providerConfigs).where(eq(providerConfigs.id, input.id)).limit(1);
    const now = new Date().toISOString();
    const configJson = JSON.stringify(input.config);

    if (existing[0]) {
      await db
        .update(providerConfigs)
        .set({
          name: input.name,
          type: input.type,
          enabled: input.enabled ?? true,
          configJson,
          updatedAt: now,
        })
        .where(eq(providerConfigs.id, input.id));
    } else {
      await db.insert(providerConfigs).values({
        id: input.id,
        name: input.name,
        type: input.type,
        enabled: input.enabled ?? true,
        configJson,
        createdAt: now,
        updatedAt: now,
      });
    }

    await this.loadIntoRegistry();

    const [saved] = await db.select().from(providerConfigs).where(eq(providerConfigs.id, input.id)).limit(1);
    if (!saved) {
      throw new Error(`Failed to persist provider config: ${input.id}`);
    }

    return {
      id: saved.id,
      name: saved.name,
      type: saved.type as ProviderConfigEntry["type"],
      enabled: saved.enabled,
      createdAt: saved.createdAt,
      updatedAt: saved.updatedAt,
      config: JSON.parse(saved.configJson) as Omit<ProviderConfigEntry, "id" | "type">,
    };
  }
}