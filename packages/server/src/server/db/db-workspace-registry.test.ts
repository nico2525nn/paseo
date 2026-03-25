import os from "node:os";
import path from "node:path";
import { mkdtempSync, rmSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, test } from "vitest";

import type { PersistedProjectRecord, PersistedWorkspaceRecord, ProjectRegistry, WorkspaceRegistry } from "../workspace-registry.js";
import { createPersistedProjectRecord, createPersistedWorkspaceRecord } from "../workspace-registry.js";
import { openPaseoDatabase, type PaseoDatabaseHandle } from "./pglite-database.js";
import { DbProjectRegistry } from "./db-project-registry.js";
import { DbWorkspaceRegistry } from "./db-workspace-registry.js";

function createProjectRecord(input: Partial<PersistedProjectRecord> = {}): PersistedProjectRecord {
  return createPersistedProjectRecord({
    projectId: "remote:github.com/acme/repo",
    rootPath: "/tmp/repo",
    kind: "git",
    displayName: "acme/repo",
    createdAt: "2026-03-01T00:00:00.000Z",
    updatedAt: "2026-03-01T00:00:00.000Z",
    archivedAt: null,
    ...input,
  });
}

function createWorkspaceRecord(input: Partial<PersistedWorkspaceRecord> = {}): PersistedWorkspaceRecord {
  return createPersistedWorkspaceRecord({
    workspaceId: "/tmp/repo",
    projectId: "remote:github.com/acme/repo",
    cwd: "/tmp/repo",
    kind: "local_checkout",
    displayName: "main",
    createdAt: "2026-03-01T00:00:00.000Z",
    updatedAt: "2026-03-01T00:00:00.000Z",
    archivedAt: null,
    ...input,
  });
}

describe("DB-backed workspace registries", () => {
  let tmpDir: string;
  let dataDir: string;
  let database: PaseoDatabaseHandle;
  let projectRegistry: ProjectRegistry;
  let workspaceRegistry: WorkspaceRegistry;

  beforeEach(async () => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "db-workspace-registry-"));
    dataDir = path.join(tmpDir, "db");
    database = await openPaseoDatabase(dataDir);
    projectRegistry = new DbProjectRegistry(database.db);
    workspaceRegistry = new DbWorkspaceRegistry(database.db);
  });

  afterEach(async () => {
    await database.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("project registry matches the file-backed behavioral contract", async () => {
    await projectRegistry.initialize();
    expect(await projectRegistry.existsOnDisk()).toBe(true);
    expect(await projectRegistry.get("missing-project")).toBeNull();
    expect(await projectRegistry.list()).toEqual([]);

    await projectRegistry.upsert(createProjectRecord());
    await projectRegistry.upsert(
      createProjectRecord({
        updatedAt: "2026-03-02T00:00:00.000Z",
      }),
    );
    await projectRegistry.archive(
      "remote:github.com/acme/repo",
      "2026-03-03T00:00:00.000Z",
    );
    await projectRegistry.archive("missing-project", "2026-03-04T00:00:00.000Z");

    expect(await projectRegistry.get("remote:github.com/acme/repo")).toEqual(
      createProjectRecord({
        updatedAt: "2026-03-03T00:00:00.000Z",
        archivedAt: "2026-03-03T00:00:00.000Z",
      }),
    );
    expect(await projectRegistry.list()).toEqual([
      createProjectRecord({
        updatedAt: "2026-03-03T00:00:00.000Z",
        archivedAt: "2026-03-03T00:00:00.000Z",
      }),
    ]);

    await projectRegistry.remove("missing-project");
    await projectRegistry.remove("remote:github.com/acme/repo");

    expect(await projectRegistry.get("remote:github.com/acme/repo")).toBeNull();
    expect(await projectRegistry.list()).toEqual([]);
  });

  test("workspace registry matches the file-backed behavioral contract", async () => {
    await workspaceRegistry.initialize();
    expect(await workspaceRegistry.existsOnDisk()).toBe(true);
    expect(await workspaceRegistry.get("missing-workspace")).toBeNull();
    expect(await workspaceRegistry.list()).toEqual([]);

    await projectRegistry.upsert(createProjectRecord());
    await workspaceRegistry.upsert(createWorkspaceRecord());
    await workspaceRegistry.upsert(
      createWorkspaceRecord({
        displayName: "feature/workspace",
        updatedAt: "2026-03-02T00:00:00.000Z",
      }),
    );
    await workspaceRegistry.archive("/tmp/repo", "2026-03-03T00:00:00.000Z");
    await workspaceRegistry.archive("missing-workspace", "2026-03-04T00:00:00.000Z");

    expect(await workspaceRegistry.get("/tmp/repo")).toEqual(
      createWorkspaceRecord({
        displayName: "feature/workspace",
        updatedAt: "2026-03-03T00:00:00.000Z",
        archivedAt: "2026-03-03T00:00:00.000Z",
      }),
    );
    expect(await workspaceRegistry.list()).toEqual([
      createWorkspaceRecord({
        displayName: "feature/workspace",
        updatedAt: "2026-03-03T00:00:00.000Z",
        archivedAt: "2026-03-03T00:00:00.000Z",
      }),
    ]);

    await workspaceRegistry.remove("missing-workspace");
    await workspaceRegistry.remove("/tmp/repo");

    expect(await workspaceRegistry.get("/tmp/repo")).toBeNull();
    expect(await workspaceRegistry.list()).toEqual([]);
  });

  test("rejects workspace upserts for non-existent projects", async () => {
    await expect(
      workspaceRegistry.upsert(
        createWorkspaceRecord({
          projectId: "remote:github.com/acme/missing",
        }),
      ),
    ).rejects.toThrow();
  });

  test("rejects project removal while linked workspaces exist", async () => {
    await projectRegistry.upsert(createProjectRecord());
    await workspaceRegistry.upsert(createWorkspaceRecord());

    await expect(projectRegistry.remove("remote:github.com/acme/repo")).rejects.toThrow();
    expect(await projectRegistry.get("remote:github.com/acme/repo")).toEqual(createProjectRecord());
  });
});
