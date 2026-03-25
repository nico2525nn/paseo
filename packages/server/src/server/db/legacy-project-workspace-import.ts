import path from "node:path";
import { promises as fs } from "node:fs";

import { count } from "drizzle-orm";
import type { Logger } from "pino";

import {
  parsePersistedProjectRecords,
  parsePersistedWorkspaceRecords,
} from "../workspace-registry.js";
import type { PaseoDatabaseHandle } from "./pglite-database.js";
import { projects, workspaces } from "./schema.js";

export type LegacyProjectWorkspaceImportResult =
  | {
      status: "imported";
      importedProjects: number;
      importedWorkspaces: number;
    }
  | {
      status: "skipped";
      reason: "database-not-empty" | "no-legacy-files";
    };

export async function importLegacyProjectWorkspaceJson(options: {
  db: PaseoDatabaseHandle["db"];
  paseoHome: string;
  logger: Logger;
}): Promise<LegacyProjectWorkspaceImportResult> {
  const projectsPath = path.join(options.paseoHome, "projects", "projects.json");
  const workspacesPath = path.join(options.paseoHome, "projects", "workspaces.json");
  const [projectRows, workspaceRows, databaseHasRows] = await Promise.all([
    readLegacyProjects(projectsPath),
    readLegacyWorkspaces(workspacesPath),
    hasAnyProjectWorkspaceRows(options.db),
  ]);

  if (databaseHasRows) {
    options.logger.info("Skipping legacy project/workspace JSON import because the DB is not empty");
    return {
      status: "skipped",
      reason: "database-not-empty",
    };
  }

  if (projectRows.length === 0 && workspaceRows.length === 0) {
    options.logger.info("Skipping legacy project/workspace JSON import because no legacy files exist");
    return {
      status: "skipped",
      reason: "no-legacy-files",
    };
  }

  await options.db.transaction(async (tx) => {
    if (projectRows.length > 0) {
      await tx.insert(projects).values(projectRows);
    }
    if (workspaceRows.length > 0) {
      await tx.insert(workspaces).values(workspaceRows);
    }
  });

  options.logger.info(
    {
      importedProjects: projectRows.length,
      importedWorkspaces: workspaceRows.length,
    },
    "Imported legacy project/workspace JSON into the database",
  );

  return {
    status: "imported",
    importedProjects: projectRows.length,
    importedWorkspaces: workspaceRows.length,
  };
}

async function readLegacyProjects(filePath: string) {
  const raw = await readOptionalJsonFile(filePath);
  return raw ? parsePersistedProjectRecords(raw) : [];
}

async function readLegacyWorkspaces(filePath: string) {
  const raw = await readOptionalJsonFile(filePath);
  return raw ? parsePersistedWorkspaceRecords(raw) : [];
}

async function readOptionalJsonFile(filePath: string): Promise<unknown | null> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function hasAnyProjectWorkspaceRows(db: PaseoDatabaseHandle["db"]): Promise<boolean> {
  const [projectCountRows, workspaceCountRows] = await Promise.all([
    db.select({ count: count() }).from(projects),
    db.select({ count: count() }).from(workspaces),
  ]);
  const projectCount = projectCountRows[0]?.count ?? 0;
  const workspaceCount = workspaceCountRows[0]?.count ?? 0;
  return projectCount > 0 || workspaceCount > 0;
}
