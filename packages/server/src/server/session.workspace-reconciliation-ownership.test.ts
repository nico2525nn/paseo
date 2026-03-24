import { describe, expect, test, vi } from "vitest";

import { Session } from "./session.js";
import {
  createPersistedProjectRecord,
  createPersistedWorkspaceRecord,
} from "./workspace-registry.js";

function createSessionForOwnershipTests(options?: { workspaceReconciliationService?: any }) {
  const emitted: Array<{ type: string; payload: unknown }> = [];
  const logger = {
    child: () => logger,
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };

  const session = new Session({
    clientId: "test-client",
    onMessage: (message) => emitted.push(message as any),
    logger: logger as any,
    downloadTokenStore: {} as any,
    pushTokenStore: {} as any,
    paseoHome: "/tmp/paseo-test",
    agentManager: {
      subscribe: () => () => {},
      listAgents: () => [],
      getAgent: () => null,
    } as any,
    agentStorage: {
      list: async () => [],
      get: async () => null,
    } as any,
    projectRegistry: {
      initialize: async () => {},
      existsOnDisk: async () => true,
      list: async () => [],
      get: async (projectId: string) =>
        createPersistedProjectRecord({
          projectId,
          rootPath: "/tmp/repo",
          kind: "non_git",
          displayName: "repo",
          createdAt: "2026-03-01T00:00:00.000Z",
          updatedAt: "2026-03-01T00:00:00.000Z",
        }),
      upsert: async () => {
        throw new Error("not used");
      },
      archive: async () => {
        throw new Error("not used");
      },
      remove: async () => {
        throw new Error("not used");
      },
    } as any,
    workspaceRegistry: {
      initialize: async () => {},
      existsOnDisk: async () => true,
      list: async () => [],
      get: async () => null,
      upsert: async () => {
        throw new Error("not used");
      },
      archive: async () => {
        throw new Error("not used");
      },
      remove: async () => {
        throw new Error("not used");
      },
    } as any,
    createAgentMcpTransport: async () => {
      throw new Error("not used");
    },
    stt: null,
    tts: null,
    terminalManager: null,
    workspaceReconciliationService: options?.workspaceReconciliationService,
  }) as any;

  return { session, emitted };
}

describe("workspace reconciliation ownership", () => {
  test("open_project_request delegates registration to WorkspaceReconciliationService", async () => {
    const reconcileWorkspaceRecord = vi.fn(async () => ({
      workspace: createPersistedWorkspaceRecord({
        workspaceId: "/tmp/repo",
        projectId: "/tmp/repo",
        cwd: "/tmp/repo",
        kind: "directory",
        displayName: "repo",
        createdAt: "2026-03-01T00:00:00.000Z",
        updatedAt: "2026-03-01T00:00:00.000Z",
      }),
      changed: true,
    }));
    const { session, emitted } = createSessionForOwnershipTests({
      workspaceReconciliationService: {
        reconcileWorkspaceRecord,
        reconcileActiveWorkspaceRecords: async () => new Set<string>(),
        registerPendingWorktreeWorkspace: async () => {
          throw new Error("not used");
        },
        archiveWorkspaceRecord: async () => {},
      },
    });
    session.buildProjectPlacement = async (cwd: string) => ({
      projectKey: cwd,
      projectName: "repo",
      checkout: {
        cwd,
        isGit: false,
        currentBranch: null,
        remoteUrl: null,
        isPaseoOwnedWorktree: false,
        mainRepoRoot: null,
      },
    });
    session.emitWorkspaceUpdateForCwd = vi.fn(async () => {});

    await session.handleMessage({
      type: "open_project_request",
      cwd: "/tmp/repo",
      requestId: "req-open",
    });

    expect(reconcileWorkspaceRecord).toHaveBeenCalledWith("/tmp/repo");
    expect(emitted).toContainEqual({
      type: "open_project_response",
      payload: expect.objectContaining({
        requestId: "req-open",
        error: null,
        workspace: expect.objectContaining({
          id: "/tmp/repo",
        }),
      }),
    });
  });

  test("workspace update fanout delegates sweep to WorkspaceReconciliationService", async () => {
    const reconcileActiveWorkspaceRecords = vi.fn(
      async () => new Set(["/tmp/repo", "/tmp/repo/worktree"]),
    );
    const { session, emitted } = createSessionForOwnershipTests({
      workspaceReconciliationService: {
        reconcileWorkspaceRecord: async () => {
          throw new Error("not used");
        },
        reconcileActiveWorkspaceRecords,
        registerPendingWorktreeWorkspace: async () => {
          throw new Error("not used");
        },
        archiveWorkspaceRecord: async () => {},
      },
    });

    session.workspaceUpdatesSubscription = {
      subscriptionId: "sub-ownership",
      filter: undefined,
      isBootstrapping: false,
      pendingUpdatesByWorkspaceId: new Map(),
    };
    session.listWorkspaceDescriptorsSnapshot = async () => [
      {
        id: "/tmp/repo",
        projectId: "/tmp/repo",
        projectDisplayName: "repo",
        projectRootPath: "/tmp/repo",
        projectKind: "non_git",
        workspaceKind: "directory",
        name: "repo",
        status: "done",
        activityAt: null,
      },
      {
        id: "/tmp/repo/worktree",
        projectId: "/tmp/repo",
        projectDisplayName: "repo",
        projectRootPath: "/tmp/repo",
        projectKind: "git",
        workspaceKind: "worktree",
        name: "feature-a",
        status: "running",
        activityAt: "2026-03-01T12:00:00.000Z",
      },
    ];

    await session.emitWorkspaceUpdateForCwd("/tmp/repo/worktree");

    expect(reconcileActiveWorkspaceRecords).toHaveBeenCalledTimes(1);
    const workspaceUpdates = emitted.filter((message) => message.type === "workspace_update") as
      | Array<{ type: "workspace_update"; payload: any }>;
    expect(workspaceUpdates.map((message) => message.payload.workspace.id).sort()).toEqual([
      "/tmp/repo",
      "/tmp/repo/worktree",
    ]);
  });
});
