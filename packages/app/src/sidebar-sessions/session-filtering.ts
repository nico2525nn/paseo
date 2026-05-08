import type { SidebarSessionAgent, SidebarSessionFilter, SidebarSessionWorkspace } from "./types";
import type { SidebarProjectEntry } from "@/hooks/use-sidebar-workspaces-list";
import type { WorkspaceDescriptor } from "@/stores/session-store";
import { normalizeWorkspacePath } from "@/utils/workspace-identity";

export interface SidebarSessionWorkspaceLookup {
  workspaceByExecutionKey: Map<string, SidebarSessionWorkspace>;
}

export interface SidebarSessionFilterAvailability {
  projectKeys: readonly string[];
}

export interface SidebarSessionGroup {
  projectKey: string;
  projectName: string;
  projectIconKey: string | null;
  visibleIds: readonly string[];
  hiddenCount: number;
  isExpanded: boolean;
  totalCount: number;
}

export interface SidebarSessionAgentProject {
  id: string;
  projectKey: string;
  projectName: string;
  projectIconKey: string | null;
}

interface SidebarSessionGroupDraft {
  projectKey: string;
  projectName: string;
  projectIconKey: string | null;
  ids: string[];
}

const DEFAULT_GROUPED_SESSION_LIMIT = 6;

function executionKey(serverId: string, cwd: string): string {
  return `${serverId}:${cwd}`;
}

export function createSidebarSessionWorkspaceLookup(
  workspaces: readonly SidebarSessionWorkspace[],
): SidebarSessionWorkspaceLookup {
  const workspaceByExecutionKey = new Map<string, SidebarSessionWorkspace>();
  for (const workspace of workspaces) {
    const normalizedDirectory = normalizeWorkspacePath(workspace.workspaceDirectory);
    if (!normalizedDirectory) {
      continue;
    }
    workspaceByExecutionKey.set(executionKey(workspace.serverId, normalizedDirectory), workspace);
  }
  return { workspaceByExecutionKey };
}

export function resolveSidebarSessionWorkspace(
  lookup: SidebarSessionWorkspaceLookup,
  agent: SidebarSessionAgent,
): SidebarSessionWorkspace | null {
  const normalizedCwd = normalizeWorkspacePath(agent.cwd);
  if (!normalizedCwd) {
    return null;
  }
  return lookup.workspaceByExecutionKey.get(executionKey(agent.serverId, normalizedCwd)) ?? null;
}

export function resolveSidebarSessionWorkspaceId(input: {
  agent: SidebarSessionAgent;
  workspaces: Iterable<WorkspaceDescriptor> | null | undefined;
}): string | null {
  const normalizedCwd = normalizeWorkspacePath(input.agent.cwd);
  if (!normalizedCwd) {
    return null;
  }

  for (const workspace of input.workspaces ?? []) {
    if (normalizeWorkspacePath(workspace.workspaceDirectory) === normalizedCwd) {
      return workspace.id;
    }
  }
  return null;
}

export function shouldIncludeSidebarSessionAgent(input: {
  agent: SidebarSessionAgent;
  filter: SidebarSessionFilter;
  lookup: SidebarSessionWorkspaceLookup;
}): boolean {
  if (input.agent.archivedAt) {
    return false;
  }

  const workspace = resolveSidebarSessionWorkspace(input.lookup, input.agent);
  if (!workspace) {
    return false;
  }

  if (input.filter.type === "all") {
    return true;
  }
  return workspace.projectKey === input.filter.projectKey;
}

export function deriveSidebarSessionFilterAvailability(input: {
  agents: readonly SidebarSessionAgent[];
  lookup: SidebarSessionWorkspaceLookup;
}): SidebarSessionFilterAvailability {
  const projectKeys = new Set<string>();

  for (const agent of input.agents) {
    if (agent.archivedAt) {
      continue;
    }
    const workspace = resolveSidebarSessionWorkspace(input.lookup, agent);
    if (!workspace) {
      continue;
    }
    projectKeys.add(workspace.projectKey);
  }

  return {
    projectKeys: Array.from(projectKeys).sort(),
  };
}

export function deriveSidebarSessionFilterProjects(input: {
  projects: readonly SidebarProjectEntry[];
  availability: SidebarSessionFilterAvailability;
}): SidebarProjectEntry[] {
  if (input.projects.length === 0 || input.availability.projectKeys.length === 0) {
    return [];
  }

  const visibleProjectKeys = new Set(input.availability.projectKeys);
  const projects: SidebarProjectEntry[] = [];

  for (const project of input.projects) {
    if (!visibleProjectKeys.has(project.projectKey)) {
      continue;
    }
    projects.push(project);
  }

  return projects;
}

export function deriveGroupedSidebarSessions(input: {
  agentsWithProjects: readonly SidebarSessionAgentProject[];
  expandedProjects: ReadonlySet<string>;
  limit?: number;
}): readonly SidebarSessionGroup[] {
  const limit = input.limit ?? DEFAULT_GROUPED_SESSION_LIMIT;
  const groupsByProject = new Map<string, SidebarSessionGroupDraft>();

  for (const agent of input.agentsWithProjects) {
    let group = groupsByProject.get(agent.projectKey);
    if (!group) {
      group = {
        projectKey: agent.projectKey,
        projectName: agent.projectName,
        projectIconKey: agent.projectIconKey,
        ids: [],
      };
      groupsByProject.set(agent.projectKey, group);
    }
    group.ids.push(agent.id);
  }

  return Array.from(groupsByProject.values(), (group) => {
    const isExpanded = input.expandedProjects.has(group.projectKey);
    const visibleIds = isExpanded ? group.ids : group.ids.slice(0, limit);
    return {
      projectKey: group.projectKey,
      projectName: group.projectName,
      projectIconKey: group.projectIconKey,
      visibleIds,
      hiddenCount: isExpanded ? 0 : Math.max(0, group.ids.length - limit),
      isExpanded,
      totalCount: group.ids.length,
    };
  });
}
