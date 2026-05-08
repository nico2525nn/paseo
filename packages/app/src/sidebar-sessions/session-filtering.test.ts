import { describe, expect, it } from "vitest";
import {
  createSidebarSessionWorkspaceLookup,
  deriveGroupedSidebarSessions,
  deriveSidebarSessionFilterAvailability,
  deriveSidebarSessionFilterProjects,
  shouldIncludeSidebarSessionAgent,
} from "./session-filtering";
import type { SidebarSessionAgent, SidebarSessionWorkspace } from "./types";

interface TestProject {
  projectKey: string;
  projectName: string;
  projectIconKey: string | null;
}

const WORKSPACES: SidebarSessionWorkspace[] = [
  {
    serverId: "server-1",
    workspaceId: "workspace-1",
    workspaceKey: "server-1:workspace-1",
    workspaceName: "Main",
    projectKey: "project-a",
    projectName: "Project A",
    projectIconKey: "/repo/main",
    workspaceDirectory: "/repo/main",
  },
  {
    serverId: "server-1",
    workspaceId: "workspace-2",
    workspaceKey: "server-1:workspace-2",
    workspaceName: "Docs",
    projectKey: "project-b",
    projectName: "Project B",
    projectIconKey: "/repo/docs",
    workspaceDirectory: "/repo/docs",
  },
  {
    serverId: "server-1",
    workspaceId: "workspace-3",
    workspaceKey: "server-1:workspace-3",
    workspaceName: "API",
    projectKey: "project-a",
    projectName: "Project A",
    projectIconKey: "/repo/main",
    workspaceDirectory: "/repo/api",
  },
];

const AGENTS: SidebarSessionAgent[] = [
  { id: "main", serverId: "server-1", cwd: "/repo/main/", archivedAt: null },
  { id: "docs", serverId: "server-1", cwd: "/repo/docs", archivedAt: null },
  { id: "api", serverId: "server-1", cwd: "/repo/api", archivedAt: null },
  { id: "unmapped", serverId: "server-1", cwd: "/repo/missing", archivedAt: null },
  { id: "other-server", serverId: "server-2", cwd: "/repo/main", archivedAt: null },
  {
    id: "archived",
    serverId: "server-1",
    cwd: "/repo/main",
    archivedAt: new Date("2026-05-08T10:00:00.000Z"),
  },
];

function projectWorkspaceKeys(project: {
  projectKey: string;
  workspaces: { workspaceKey: string }[];
}) {
  return {
    projectKey: project.projectKey,
    workspaceKeys: project.workspaces.map((workspace) => workspace.workspaceKey),
  };
}

function testProject(key: string, name = key): TestProject {
  return {
    projectKey: key,
    projectName: name,
    projectIconKey: `/repo/${key}`,
  };
}

function agentProject(id: string, project: TestProject) {
  return { id, ...project };
}

function agentProjects(ids: readonly string[], project: TestProject) {
  return ids.map((id) => agentProject(id, project));
}

describe("sidebar session filtering", () => {
  it("hides unmapped agents and includes every mapped active agent for All", () => {
    const lookup = createSidebarSessionWorkspaceLookup(WORKSPACES);

    const visibleIds = AGENTS.filter((agent) =>
      shouldIncludeSidebarSessionAgent({
        agent,
        filter: { type: "all" },
        lookup,
      }),
    ).map((agent) => agent.id);

    expect(visibleIds).toEqual(["main", "docs", "api"]);
  });

  it("filters by project", () => {
    const lookup = createSidebarSessionWorkspaceLookup(WORKSPACES);

    const visibleIds = AGENTS.filter((agent) =>
      shouldIncludeSidebarSessionAgent({
        agent,
        filter: { type: "project", projectKey: "project-a" },
        lookup,
      }),
    ).map((agent) => agent.id);

    expect(visibleIds).toEqual(["main", "api"]);
  });

  it("derives filter options only from mapped active agents", () => {
    const lookup = createSidebarSessionWorkspaceLookup(WORKSPACES);
    const availability = deriveSidebarSessionFilterAvailability({
      agents: [
        AGENTS[0],
        AGENTS[3],
        {
          id: "archived-docs",
          serverId: "server-1",
          cwd: "/repo/docs",
          archivedAt: new Date("2026-05-08T10:00:00.000Z"),
        },
      ],
      lookup,
    });

    expect(availability).toEqual({
      projectKeys: ["project-a"],
    });
    const filterProjects = deriveSidebarSessionFilterProjects({
      projects: [
        {
          projectKey: "project-a",
          projectName: "Project A",
          projectKind: "git",
          iconWorkingDir: "/repo",
          workspaces: [
            {
              workspaceKey: "server-1:workspace-1",
              serverId: "server-1",
              workspaceId: "workspace-1",
              projectKey: "project-a",
              projectRootPath: "/repo",
              workspaceDirectory: "/repo/main",
              projectKind: "git",
              workspaceKind: "worktree",
              name: "Main",
              statusBucket: "done",
              archivingAt: null,
              diffStat: null,
              scripts: [],
              hasRunningScripts: false,
            },
            {
              workspaceKey: "server-1:workspace-3",
              serverId: "server-1",
              workspaceId: "workspace-3",
              projectKey: "project-a",
              projectRootPath: "/repo",
              workspaceDirectory: "/repo/api",
              projectKind: "git",
              workspaceKind: "worktree",
              name: "API",
              statusBucket: "done",
              archivingAt: null,
              diffStat: null,
              scripts: [],
              hasRunningScripts: false,
            },
          ],
        },
        {
          projectKey: "project-b",
          projectName: "Project B",
          projectKind: "git",
          iconWorkingDir: "/repo/docs",
          workspaces: [
            {
              workspaceKey: "server-1:workspace-2",
              serverId: "server-1",
              workspaceId: "workspace-2",
              projectKey: "project-b",
              projectRootPath: "/repo/docs",
              workspaceDirectory: "/repo/docs",
              projectKind: "git",
              workspaceKind: "worktree",
              name: "Docs",
              statusBucket: "done",
              archivingAt: null,
              diffStat: null,
              scripts: [],
              hasRunningScripts: false,
            },
          ],
        },
      ],
      availability,
    });

    expect(filterProjects.map(projectWorkspaceKeys)).toEqual([
      {
        projectKey: "project-a",
        workspaceKeys: ["server-1:workspace-1", "server-1:workspace-3"],
      },
    ]);
  });
});

describe("deriveGroupedSidebarSessions", () => {
  it("returns no groups for empty input", () => {
    expect(
      deriveGroupedSidebarSessions({
        agentsWithProjects: [],
        expandedProjects: new Set(),
      }),
    ).toEqual([]);
  });

  it("keeps a single project under the limit fully visible and collapsed", () => {
    const groups = deriveGroupedSidebarSessions({
      agentsWithProjects: agentProjects(["a1", "a2", "a3"], testProject("project-a")),
      expandedProjects: new Set(),
      limit: 6,
    });

    expect(groups).toEqual([
      {
        projectKey: "project-a",
        projectName: "project-a",
        projectIconKey: "/repo/project-a",
        visibleIds: ["a1", "a2", "a3"],
        hiddenCount: 0,
        isExpanded: false,
        totalCount: 3,
      },
    ]);
  });

  it("caps a collapsed project over the limit", () => {
    const orderedIds = Array.from({ length: 10 }, (_, index) => `a${index + 1}`);
    const projectA = testProject("project-a");
    const groups = deriveGroupedSidebarSessions({
      agentsWithProjects: agentProjects(orderedIds, projectA),
      expandedProjects: new Set(),
      limit: 6,
    });

    expect(groups[0]).toMatchObject({
      visibleIds: ["a1", "a2", "a3", "a4", "a5", "a6"],
      hiddenCount: 4,
      isExpanded: false,
      totalCount: 10,
    });
  });

  it("shows every id for an expanded project over the limit", () => {
    const orderedIds = Array.from({ length: 10 }, (_, index) => `a${index + 1}`);
    const projectA = testProject("project-a");
    const groups = deriveGroupedSidebarSessions({
      agentsWithProjects: agentProjects(orderedIds, projectA),
      expandedProjects: new Set(["project-a"]),
      limit: 6,
    });

    expect(groups[0]).toMatchObject({
      visibleIds: orderedIds,
      hiddenCount: 0,
      isExpanded: true,
      totalCount: 10,
    });
  });

  it("orders projects by first occurrence in ordered ids", () => {
    const groups = deriveGroupedSidebarSessions({
      agentsWithProjects: [
        agentProject("a1", testProject("project-a")),
        agentProject("b1", testProject("project-b")),
        agentProject("a2", testProject("project-a")),
      ],
      expandedProjects: new Set(),
    });

    expect(groups.map((group) => group.projectKey)).toEqual(["project-a", "project-b"]);
  });

  it("preserves order within each project", () => {
    const groups = deriveGroupedSidebarSessions({
      agentsWithProjects: agentProjects(["a1", "a2", "a3"], testProject("project-a")),
      expandedProjects: new Set(),
    });

    expect(groups[0]?.visibleIds).toEqual(["a1", "a2", "a3"]);
  });

  it("preserves mapped project order after unmapped ids are filtered upstream", () => {
    const groups = deriveGroupedSidebarSessions({
      agentsWithProjects: [
        agentProject("a1", testProject("project-a")),
        agentProject("b1", testProject("project-b")),
        agentProject("a2", testProject("project-a")),
      ],
      expandedProjects: new Set(),
    });

    expect(groups.map((group) => ({ key: group.projectKey, ids: group.visibleIds }))).toEqual([
      { key: "project-a", ids: ["a1", "a2"] },
      { key: "project-b", ids: ["b1"] },
    ]);
  });

  it("defaults the collapsed limit to 6", () => {
    const orderedIds = Array.from({ length: 7 }, (_, index) => `a${index + 1}`);
    const projectA = testProject("project-a");
    const groups = deriveGroupedSidebarSessions({
      agentsWithProjects: agentProjects(orderedIds, projectA),
      expandedProjects: new Set(),
    });

    expect(groups[0]?.visibleIds).toHaveLength(6);
    expect(groups[0]?.hiddenCount).toBe(1);
  });

  it("honors a custom collapsed limit", () => {
    const groups = deriveGroupedSidebarSessions({
      agentsWithProjects: agentProjects(["a1", "a2", "a3", "a4"], testProject("project-a")),
      expandedProjects: new Set(),
      limit: 2,
    });

    expect(groups[0]).toMatchObject({
      visibleIds: ["a1", "a2"],
      hiddenCount: 2,
    });
  });
});
