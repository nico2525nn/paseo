import equal from "fast-deep-equal";
import { useMemo } from "react";
import { useStoreWithEqualityFn } from "zustand/traditional";
import { useSessionStore } from "@/stores/session-store";
import type { SidebarProjectEntry } from "@/hooks/use-sidebar-workspaces-list";
import type { SidebarSessionWorkspace } from "./types";
import {
  createSidebarSessionWorkspaceLookup,
  deriveSidebarSessionFilterAvailability,
  deriveSidebarSessionFilterProjects,
} from "./session-filtering";

const EMPTY_WORKSPACES: SidebarSessionWorkspace[] = [];
const EMPTY_AVAILABILITY = { workspaceKeys: [], projectKeys: [] } as const;

export function useSidebarSessionWorkspaces(input: {
  serverId: string | null;
  projects: readonly SidebarProjectEntry[];
}): SidebarSessionWorkspace[] {
  const workspaceDirectoryById = useStoreWithEqualityFn(
    useSessionStore,
    (state) => {
      if (!input.serverId) {
        return {};
      }
      const workspaces = state.sessions[input.serverId]?.workspaces;
      if (!workspaces || workspaces.size === 0) {
        return {};
      }

      const directoryById: Record<string, string> = {};
      for (const workspace of workspaces.values()) {
        directoryById[workspace.id] = workspace.workspaceDirectory;
      }
      return directoryById;
    },
    equal,
  );

  return useMemo(() => {
    if (!input.serverId || input.projects.length === 0) {
      return EMPTY_WORKSPACES;
    }

    const result: SidebarSessionWorkspace[] = [];
    for (const project of input.projects) {
      for (const workspace of project.workspaces) {
        const workspaceDirectory = workspaceDirectoryById[workspace.workspaceId];
        if (!workspaceDirectory) {
          continue;
        }
        result.push({
          serverId: input.serverId,
          workspaceId: workspace.workspaceId,
          workspaceKey: workspace.workspaceKey,
          workspaceName: workspace.name,
          projectKey: project.projectKey,
          projectName: project.projectName,
          workspaceDirectory,
        });
      }
    }
    return result;
  }, [input.projects, input.serverId, workspaceDirectoryById]);
}

export function useVisibleSidebarSessionFilterProjects(input: {
  serverId: string | null;
  projects: readonly SidebarProjectEntry[];
}): SidebarProjectEntry[] {
  const workspaces = useSidebarSessionWorkspaces(input);
  const lookup = useMemo(() => createSidebarSessionWorkspaceLookup(workspaces), [workspaces]);
  const availability = useStoreWithEqualityFn(
    useSessionStore,
    (state) => {
      if (!input.serverId || lookup.workspaceByExecutionKey.size === 0) {
        return EMPTY_AVAILABILITY;
      }
      const serverId = input.serverId;
      const agents = state.sessions[serverId]?.agents;
      if (!agents || agents.size === 0) {
        return EMPTY_AVAILABILITY;
      }
      return deriveSidebarSessionFilterAvailability({
        agents: Array.from(agents.values(), (agent) => ({
          id: agent.id,
          serverId,
          cwd: agent.cwd,
          archivedAt: agent.archivedAt ?? null,
        })),
        lookup,
      });
    },
    equal,
  );

  return useMemo(
    () =>
      deriveSidebarSessionFilterProjects({
        projects: input.projects,
        availability,
      }),
    [availability, input.projects],
  );
}
