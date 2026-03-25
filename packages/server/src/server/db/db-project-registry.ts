import { eq } from "drizzle-orm";

import type { PersistedProjectKind } from "../workspace-registry-model.js";
import type { ProjectRegistry, PersistedProjectRecord } from "../workspace-registry.js";
import { createPersistedProjectRecord } from "../workspace-registry.js";
import { projects } from "./schema.js";
import type { PaseoDatabaseHandle } from "./pglite-database.js";

function toPersistedProjectRecord(row: typeof projects.$inferSelect): PersistedProjectRecord {
  return createPersistedProjectRecord({
    ...row,
    kind: row.kind as PersistedProjectKind,
  });
}

export class DbProjectRegistry implements ProjectRegistry {
  private readonly db: PaseoDatabaseHandle["db"];

  constructor(db: PaseoDatabaseHandle["db"]) {
    this.db = db;
  }

  async initialize(): Promise<void> {
    return Promise.resolve();
  }

  async existsOnDisk(): Promise<boolean> {
    return true;
  }

  async list(): Promise<PersistedProjectRecord[]> {
    const rows = await this.db.select().from(projects);
    return rows.map(toPersistedProjectRecord);
  }

  async get(projectId: string): Promise<PersistedProjectRecord | null> {
    const rows = await this.db.select().from(projects).where(eq(projects.projectId, projectId)).limit(1);
    const row = rows[0];
    return row ? toPersistedProjectRecord(row) : null;
  }

  async upsert(record: PersistedProjectRecord): Promise<void> {
    const nextRecord = createPersistedProjectRecord(record);
    await this.db
      .insert(projects)
      .values(nextRecord)
      .onConflictDoUpdate({
        target: projects.projectId,
        set: {
          rootPath: nextRecord.rootPath,
          kind: nextRecord.kind,
          displayName: nextRecord.displayName,
          createdAt: nextRecord.createdAt,
          updatedAt: nextRecord.updatedAt,
          archivedAt: nextRecord.archivedAt,
        },
      });
  }

  async archive(projectId: string, archivedAt: string): Promise<void> {
    await this.db
      .update(projects)
      .set({
        updatedAt: archivedAt,
        archivedAt,
      })
      .where(eq(projects.projectId, projectId));
  }

  async remove(projectId: string): Promise<void> {
    await this.db.delete(projects).where(eq(projects.projectId, projectId));
  }
}
