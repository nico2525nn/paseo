import { describe, expect, test, vi } from "vitest";

import type { ProjectPlacementPayload } from "./messages.js";
import { WorkspaceReconciliationService } from "./workspace-reconciliation-service.js";
import {
  createPersistedProjectRecord,
  createPersistedWorkspaceRecord,
} from "./workspace-registry.js";

function createProjectPlacement(input: {
  cwd: string;
  projectId: string;
  projectName: string;
  isGit: boolean;
  branchName?: string | null;
  remoteUrl?: string | null;
  isPaseoOwnedWorktree?: boolean;
  mainRepoRoot?: string | null;
}): ProjectPlacementPayload {
  return {
    projectKey: input.projectId,
    projectName: input.projectName,
    checkout: {
      cwd: input.cwd,
      isGit: input.isGit,
      currentBranch: input.branchName ?? null,
      remoteUrl: input.remoteUrl ?? null,
      isPaseoOwnedWorktree: input.isPaseoOwnedWorktree ?? false,
      mainRepoRoot: input.mainRepoRoot ?? null,
    },
  };
}

function createInMemoryRegistries() {
  const projects = new Map<string, ReturnType<typeof createPersistedProjectRecord>>();
  const workspaces = new Map<string, ReturnType<typeof createPersistedWorkspaceRecord>>();

  return {
    projects,
    projectRegistry: {
      initialize: async () => {},
      existsOnDisk: async () => true,
      list: async () => Array.from(projects.values()),
      get: async (projectId: string) => projects.get(projectId) ?? null,
      upsert: async (record: ReturnType<typeof createPersistedProjectRecord>) => {
        projects.set(record.projectId, record);
      },
      archive: async (projectId: string, archivedAt: string) => {
        const existing = projects.get(projectId);
        if (!existing) {
          return;
        }
        projects.set(projectId, {
          ...existing,
          archivedAt,
          updatedAt: archivedAt,
        });
      },
      remove: async (projectId: string) => {
        projects.delete(projectId);
      },
    },
    workspaces,
    workspaceRegistry: {
      initialize: async () => {},
      existsOnDisk: async () => true,
      list: async () => Array.from(workspaces.values()),
      get: async (workspaceId: string) => workspaces.get(workspaceId) ?? null,
      upsert: async (record: ReturnType<typeof createPersistedWorkspaceRecord>) => {
        workspaces.set(record.workspaceId, record);
      },
      archive: async (workspaceId: string, archivedAt: string) => {
        const existing = workspaces.get(workspaceId);
        if (!existing) {
          return;
        }
        workspaces.set(workspaceId, {
          ...existing,
          archivedAt,
          updatedAt: archivedAt,
        });
      },
      remove: async (workspaceId: string) => {
        workspaces.delete(workspaceId);
      },
    },
  };
}

describe("WorkspaceReconciliationService", () => {
  test("reconcileWorkspaceRecord registers a new workspace and project", async () => {
    const { projects, projectRegistry, workspaces, workspaceRegistry } = createInMemoryRegistries();
    const syncWorkspaceGitWatchTarget = vi.fn(async () => {});
    const service = new WorkspaceReconciliationService({
      projectRegistry: projectRegistry as any,
      workspaceRegistry: workspaceRegistry as any,
      agentStorage: {
        list: async () => [],
      } as any,
      buildProjectPlacement: async (cwd: string) =>
        createProjectPlacement({
          cwd,
          projectId: cwd,
          projectName: "repo",
          isGit: false,
        }),
      syncWorkspaceGitWatchTarget,
      removeWorkspaceGitWatchTarget: vi.fn(),
      now: () => "2026-03-25T00:00:00.000Z",
    });

    const result = await service.reconcileWorkspaceRecord("/tmp/repo");

    expect(result).toEqual({
      changed: true,
      workspace: createPersistedWorkspaceRecord({
        workspaceId: "/tmp/repo",
        projectId: "/tmp/repo",
        cwd: "/tmp/repo",
        kind: "directory",
        displayName: "repo",
        createdAt: "2026-03-25T00:00:00.000Z",
        updatedAt: "2026-03-25T00:00:00.000Z",
      }),
    });
    expect(projects.get("/tmp/repo")).toEqual(
      createPersistedProjectRecord({
        projectId: "/tmp/repo",
        rootPath: "/tmp/repo",
        kind: "non_git",
        displayName: "repo",
        createdAt: "2026-03-25T00:00:00.000Z",
        updatedAt: "2026-03-25T00:00:00.000Z",
      }),
    );
    expect(workspaces.get("/tmp/repo")).toEqual(result.workspace);
    expect(syncWorkspaceGitWatchTarget).toHaveBeenCalledWith("/tmp/repo", {
      isGit: false,
    });
  });

  test("registerPendingWorktreeWorkspace preregisters a git worktree under the repo project", async () => {
    const { projects, projectRegistry, workspaces, workspaceRegistry } = createInMemoryRegistries();
    const syncWorkspaceGitWatchTarget = vi.fn(async () => {});
    const service = new WorkspaceReconciliationService({
      projectRegistry: projectRegistry as any,
      workspaceRegistry: workspaceRegistry as any,
      agentStorage: {
        list: async () => [],
      } as any,
      buildProjectPlacement: async (cwd: string) =>
        createProjectPlacement({
          cwd,
          projectId: "remote:github.com/acme/repo",
          projectName: "acme/repo",
          isGit: true,
          branchName: "main",
          remoteUrl: "https://github.com/acme/repo.git",
        }),
      syncWorkspaceGitWatchTarget,
      removeWorkspaceGitWatchTarget: vi.fn(),
      now: () => "2026-03-25T01:00:00.000Z",
    });

    const workspace = await service.registerPendingWorktreeWorkspace({
      repoRoot: "/tmp/repo",
      worktreePath: "/tmp/repo/.paseo/worktrees/feature-a",
      branchName: "feature-a",
    });

    expect(workspace).toEqual(
      createPersistedWorkspaceRecord({
        workspaceId: "/tmp/repo/.paseo/worktrees/feature-a",
        projectId: "remote:github.com/acme/repo",
        cwd: "/tmp/repo/.paseo/worktrees/feature-a",
        kind: "worktree",
        displayName: "feature-a",
        createdAt: "2026-03-25T01:00:00.000Z",
        updatedAt: "2026-03-25T01:00:00.000Z",
      }),
    );
    expect(projects.get("remote:github.com/acme/repo")).toEqual(
      createPersistedProjectRecord({
        projectId: "remote:github.com/acme/repo",
        rootPath: "/tmp/repo",
        kind: "git",
        displayName: "acme/repo",
        createdAt: "2026-03-25T01:00:00.000Z",
        updatedAt: "2026-03-25T01:00:00.000Z",
      }),
    );
    expect(workspaces.get("/tmp/repo/.paseo/worktrees/feature-a")).toEqual(workspace);
    expect(syncWorkspaceGitWatchTarget).toHaveBeenCalledWith(
      "/tmp/repo/.paseo/worktrees/feature-a",
      {
        isGit: true,
      },
    );
  });

  test("reconcileActiveWorkspaceRecords reassigns drifted workspaces and archives the old empty project", async () => {
    const { projects, projectRegistry, workspaces, workspaceRegistry } = createInMemoryRegistries();
    const localProjectId = "/tmp/repo";
    const remoteProjectId = "remote:github.com/acme/repo";
    const mainWorkspaceId = "/tmp/repo";
    const worktreeWorkspaceId = "/tmp/repo/.paseo/worktrees/feature-a";

    projects.set(
      localProjectId,
      createPersistedProjectRecord({
        projectId: localProjectId,
        rootPath: mainWorkspaceId,
        kind: "git",
        displayName: "repo",
        createdAt: "2026-03-01T00:00:00.000Z",
        updatedAt: "2026-03-01T00:00:00.000Z",
      }),
    );
    workspaces.set(
      mainWorkspaceId,
      createPersistedWorkspaceRecord({
        workspaceId: mainWorkspaceId,
        projectId: localProjectId,
        cwd: mainWorkspaceId,
        kind: "local_checkout",
        displayName: "main",
        createdAt: "2026-03-01T00:00:00.000Z",
        updatedAt: "2026-03-01T00:00:00.000Z",
      }),
    );
    workspaces.set(
      worktreeWorkspaceId,
      createPersistedWorkspaceRecord({
        workspaceId: worktreeWorkspaceId,
        projectId: localProjectId,
        cwd: worktreeWorkspaceId,
        kind: "worktree",
        displayName: "feature-a",
        createdAt: "2026-03-01T00:00:00.000Z",
        updatedAt: "2026-03-01T00:00:00.000Z",
      }),
    );

    const service = new WorkspaceReconciliationService({
      projectRegistry: projectRegistry as any,
      workspaceRegistry: workspaceRegistry as any,
      agentStorage: {
        list: async () => [],
      } as any,
      buildProjectPlacement: async (cwd: string) =>
        createProjectPlacement({
          cwd,
          projectId: remoteProjectId,
          projectName: "acme/repo",
          isGit: true,
          branchName: cwd === mainWorkspaceId ? "main" : "feature-a",
          remoteUrl: "https://github.com/acme/repo.git",
          isPaseoOwnedWorktree: cwd !== mainWorkspaceId,
          mainRepoRoot: cwd === mainWorkspaceId ? null : mainWorkspaceId,
        }),
      syncWorkspaceGitWatchTarget: vi.fn(async () => {}),
      removeWorkspaceGitWatchTarget: vi.fn(),
      checkDirectoryExists: async () => true,
      now: () => "2026-03-25T02:00:00.000Z",
    });

    const changedWorkspaceIds = await service.reconcileActiveWorkspaceRecords();

    expect(Array.from(changedWorkspaceIds).sort()).toEqual([
      mainWorkspaceId,
      worktreeWorkspaceId,
    ]);
    expect(workspaces.get(mainWorkspaceId)?.projectId).toBe(remoteProjectId);
    expect(workspaces.get(worktreeWorkspaceId)?.projectId).toBe(remoteProjectId);
    expect(projects.get(localProjectId)?.archivedAt).toBe("2026-03-25T02:00:00.000Z");
  });

  test("reconcileActiveWorkspaceRecords archives missing-dir and all-archived-agent workspaces but keeps no-agent and active-agent cases", async () => {
    const { projects, projectRegistry, workspaces, workspaceRegistry } = createInMemoryRegistries();
    const activeWorkspaceId = "/tmp/active";
    const noAgentWorkspaceId = "/tmp/no-agents";
    const missingWorkspaceId = "/tmp/missing";
    const archivedAgentsWorkspaceId = "/tmp/all-archived";

    for (const workspaceId of [
      activeWorkspaceId,
      noAgentWorkspaceId,
      missingWorkspaceId,
      archivedAgentsWorkspaceId,
    ]) {
      projects.set(
        workspaceId,
        createPersistedProjectRecord({
          projectId: workspaceId,
          rootPath: workspaceId,
          kind: "non_git",
          displayName: workspaceId.split("/").at(-1) ?? workspaceId,
          createdAt: "2026-03-01T00:00:00.000Z",
          updatedAt: "2026-03-01T00:00:00.000Z",
        }),
      );
      workspaces.set(
        workspaceId,
        createPersistedWorkspaceRecord({
          workspaceId,
          projectId: workspaceId,
          cwd: workspaceId,
          kind: "directory",
          displayName: workspaceId.split("/").at(-1) ?? workspaceId,
          createdAt: "2026-03-01T00:00:00.000Z",
          updatedAt: "2026-03-01T00:00:00.000Z",
        }),
      );
    }

    const service = new WorkspaceReconciliationService({
      projectRegistry: projectRegistry as any,
      workspaceRegistry: workspaceRegistry as any,
      agentStorage: {
        list: async () => [
          {
            id: "archived-agent",
            cwd: archivedAgentsWorkspaceId,
            archivedAt: "2026-03-02T00:00:00.000Z",
          },
          {
            id: "inactive-agent",
            cwd: activeWorkspaceId,
            archivedAt: "2026-03-02T00:00:00.000Z",
          },
          {
            id: "active-agent",
            cwd: activeWorkspaceId,
            archivedAt: null,
          },
        ],
      } as any,
      buildProjectPlacement: async (cwd: string) =>
        createProjectPlacement({
          cwd,
          projectId: cwd,
          projectName: cwd.split("/").at(-1) ?? cwd,
          isGit: false,
        }),
      syncWorkspaceGitWatchTarget: vi.fn(async () => {}),
      removeWorkspaceGitWatchTarget: vi.fn(),
      checkDirectoryExists: async (cwd: string) => cwd !== missingWorkspaceId,
      now: () => "2026-03-25T03:00:00.000Z",
    });

    const changedWorkspaceIds = await service.reconcileActiveWorkspaceRecords();

    expect(Array.from(changedWorkspaceIds).sort()).toEqual([
      archivedAgentsWorkspaceId,
      missingWorkspaceId,
    ]);
    expect(workspaces.get(missingWorkspaceId)?.archivedAt).toBe("2026-03-25T03:00:00.000Z");
    expect(workspaces.get(archivedAgentsWorkspaceId)?.archivedAt).toBe(
      "2026-03-25T03:00:00.000Z",
    );
    expect(workspaces.get(noAgentWorkspaceId)?.archivedAt).toBeNull();
    expect(workspaces.get(activeWorkspaceId)?.archivedAt).toBeNull();
  });

  test("archiveWorkspaceRecord archives the last active workspace and its project", async () => {
    const { projects, projectRegistry, workspaces, workspaceRegistry } = createInMemoryRegistries();
    const removeWorkspaceGitWatchTarget = vi.fn();
    const projectId = "/tmp/repo";
    const workspaceId = "/tmp/repo";

    projects.set(
      projectId,
      createPersistedProjectRecord({
        projectId,
        rootPath: workspaceId,
        kind: "non_git",
        displayName: "repo",
        createdAt: "2026-03-01T00:00:00.000Z",
        updatedAt: "2026-03-01T00:00:00.000Z",
      }),
    );
    workspaces.set(
      workspaceId,
      createPersistedWorkspaceRecord({
        workspaceId,
        projectId,
        cwd: workspaceId,
        kind: "directory",
        displayName: "repo",
        createdAt: "2026-03-01T00:00:00.000Z",
        updatedAt: "2026-03-01T00:00:00.000Z",
      }),
    );

    const service = new WorkspaceReconciliationService({
      projectRegistry: projectRegistry as any,
      workspaceRegistry: workspaceRegistry as any,
      agentStorage: {
        list: async () => [],
      } as any,
      buildProjectPlacement: vi.fn(),
      syncWorkspaceGitWatchTarget: vi.fn(async () => {}),
      removeWorkspaceGitWatchTarget,
      now: () => "2026-03-25T04:00:00.000Z",
    });

    await service.archiveWorkspaceRecord(workspaceId);

    expect(workspaces.get(workspaceId)?.archivedAt).toBe("2026-03-25T04:00:00.000Z");
    expect(projects.get(projectId)?.archivedAt).toBe("2026-03-25T04:00:00.000Z");
    expect(removeWorkspaceGitWatchTarget).toHaveBeenCalledWith(workspaceId);
  });
});
