import os from "node:os";
import path from "node:path";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";

import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { createTestLogger } from "../../test-utils/test-logger.js";
import { openPaseoDatabase, type PaseoDatabaseHandle } from "./pglite-database.js";
import { importLegacyProjectWorkspaceJson } from "./legacy-project-workspace-import.js";
import { projects, workspaces } from "./schema.js";

describe("importLegacyProjectWorkspaceJson", () => {
  let tmpDir: string;
  let paseoHome: string;
  let dbDir: string;
  let database: PaseoDatabaseHandle;

  beforeEach(async () => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "paseo-legacy-import-"));
    paseoHome = path.join(tmpDir, ".paseo");
    dbDir = path.join(paseoHome, "db");
    mkdirSync(paseoHome, { recursive: true });
    database = await openPaseoDatabase(dbDir);
  });

  afterEach(async () => {
    await database?.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("imports legacy projects and workspaces once when the DB is empty", async () => {
    writeLegacyJson({
      paseoHome,
      projectsJson: [
        {
          projectId: "project-1",
          rootPath: "/tmp/project-1",
          kind: "git",
          displayName: "Project One",
          createdAt: "2026-03-01T00:00:00.000Z",
          updatedAt: "2026-03-02T00:00:00.000Z",
          archivedAt: null,
        },
      ],
      workspacesJson: [
        {
          workspaceId: "workspace-1",
          projectId: "project-1",
          cwd: "/tmp/project-1",
          kind: "local_checkout",
          displayName: "main",
          createdAt: "2026-03-01T00:00:00.000Z",
          updatedAt: "2026-03-02T00:00:00.000Z",
          archivedAt: null,
        },
      ],
    });

    const result = await importLegacyProjectWorkspaceJson({
      db: database.db,
      paseoHome,
      logger: createTestLogger(),
    });

    expect(result).toEqual({
      status: "imported",
      importedProjects: 1,
      importedWorkspaces: 1,
    });
    expect(await database.db.select().from(projects)).toEqual([
      {
        projectId: "project-1",
        rootPath: "/tmp/project-1",
        kind: "git",
        displayName: "Project One",
        createdAt: "2026-03-01T00:00:00.000Z",
        updatedAt: "2026-03-02T00:00:00.000Z",
        archivedAt: null,
      },
    ]);
    expect(await database.db.select().from(workspaces)).toEqual([
      {
        workspaceId: "workspace-1",
        projectId: "project-1",
        cwd: "/tmp/project-1",
        kind: "local_checkout",
        displayName: "main",
        createdAt: "2026-03-01T00:00:00.000Z",
        updatedAt: "2026-03-02T00:00:00.000Z",
        archivedAt: null,
      },
    ]);
  });

  test("skips import when the DB already has project or workspace data", async () => {
    await database.db.insert(projects).values({
      projectId: "existing-project",
      rootPath: "/tmp/existing-project",
      kind: "git",
      displayName: "Existing Project",
      createdAt: "2026-03-01T00:00:00.000Z",
      updatedAt: "2026-03-01T00:00:00.000Z",
      archivedAt: null,
    });
    writeLegacyJson({
      paseoHome,
      projectsJson: [
        {
          projectId: "legacy-project",
          rootPath: "/tmp/legacy-project",
          kind: "git",
          displayName: "Legacy Project",
          createdAt: "2026-03-02T00:00:00.000Z",
          updatedAt: "2026-03-02T00:00:00.000Z",
          archivedAt: null,
        },
      ],
      workspacesJson: [],
    });

    const result = await importLegacyProjectWorkspaceJson({
      db: database.db,
      paseoHome,
      logger: createTestLogger(),
    });

    expect(result).toEqual({
      status: "skipped",
      reason: "database-not-empty",
    });
    expect(
      await database.db.select().from(projects).where(eq(projects.projectId, "legacy-project")),
    ).toEqual([]);
  });

  test("rolls back the whole import when workspace insertion fails", async () => {
    writeLegacyJson({
      paseoHome,
      projectsJson: [
        {
          projectId: "project-1",
          rootPath: "/tmp/project-1",
          kind: "git",
          displayName: "Project One",
          createdAt: "2026-03-01T00:00:00.000Z",
          updatedAt: "2026-03-02T00:00:00.000Z",
          archivedAt: null,
        },
      ],
      workspacesJson: [
        {
          workspaceId: "workspace-1",
          projectId: "missing-project",
          cwd: "/tmp/project-1",
          kind: "local_checkout",
          displayName: "main",
          createdAt: "2026-03-01T00:00:00.000Z",
          updatedAt: "2026-03-02T00:00:00.000Z",
          archivedAt: null,
        },
      ],
    });

    await expect(
      importLegacyProjectWorkspaceJson({
        db: database.db,
        paseoHome,
        logger: createTestLogger(),
      }),
    ).rejects.toThrow();

    expect(await database.db.select().from(projects)).toEqual([]);
    expect(await database.db.select().from(workspaces)).toEqual([]);
  });
});

function writeLegacyJson(input: {
  paseoHome: string;
  projectsJson: unknown[];
  workspacesJson: unknown[];
}): void {
  const projectsPath = path.join(input.paseoHome, "projects", "projects.json");
  const workspacesPath = path.join(input.paseoHome, "projects", "workspaces.json");
  mkdirSync(path.dirname(projectsPath), { recursive: true });
  writeFileSync(projectsPath, JSON.stringify(input.projectsJson, null, 2), { encoding: "utf8", flag: "w" });
  writeFileSync(workspacesPath, JSON.stringify(input.workspacesJson, null, 2), {
    encoding: "utf8",
    flag: "w",
  });
}
