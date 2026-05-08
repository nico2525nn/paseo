import React, { memo, useCallback, useMemo, type ReactElement } from "react";
import { Pressable, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { shallow } from "zustand/shallow";
import { useStoreWithEqualityFn } from "zustand/traditional";
import { SidebarProjectRowVisual } from "@/components/sidebar/sidebar-project-row-visual";
import { useProjectIconQuery } from "@/hooks/use-project-icon-query";
import { useSessionStore } from "@/stores/session-store";
import {
  deriveGroupedSidebarSessions,
  type SidebarSessionAgentProject,
  type SidebarSessionGroup,
} from "./session-filtering";
import type { ResolvedSidebarSessionProject } from "./types";

const GROUPED_SESSION_LIMIT = 6;

type SessionStoreState = ReturnType<typeof useSessionStore.getState>;

export type SidebarSessionListItem =
  | { kind: "header"; projectKey: string; projectName: string; projectIconKey: string | null }
  | { kind: "row"; id: string; serverId: string }
  | { kind: "footer"; projectKey: string; hiddenCount: number; isExpanded: boolean };

type ResolveCwdToProject = (cwd: string) => ResolvedSidebarSessionProject | null;

export function useOrderedAgentProjectShape(input: {
  orderedIds: readonly string[];
  serverId: string;
  resolveCwdToProject: ResolveCwdToProject;
}): readonly SidebarSessionAgentProject[] {
  const { orderedIds, resolveCwdToProject, serverId } = input;
  const selector = useMemo(() => {
    let previousById = new Map<string, SidebarSessionAgentProject>();

    return (state: SessionStoreState) => {
      const agents = state.sessions[serverId]?.agents;
      if (!agents) {
        previousById = new Map();
        return [];
      }

      const nextById = new Map<string, SidebarSessionAgentProject>();
      const agentsWithProjects: SidebarSessionAgentProject[] = [];

      for (const id of orderedIds) {
        const agent = agents.get(id);
        if (!agent) {
          continue;
        }

        const project = resolveCwdToProject(agent.cwd);
        if (!project) {
          continue;
        }

        const previous = previousById.get(id);
        const next =
          previous &&
          previous.projectKey === project.projectKey &&
          previous.projectIconKey === project.projectIconKey &&
          previous.projectName === project.projectName
            ? previous
            : {
                id,
                projectKey: project.projectKey,
                projectIconKey: project.projectIconKey,
                projectName: project.projectName,
              };

        nextById.set(id, next);
        agentsWithProjects.push(next);
      }

      previousById = nextById;
      return agentsWithProjects;
    };
  }, [orderedIds, resolveCwdToProject, serverId]);

  return useStoreWithEqualityFn(useSessionStore, selector, shallow);
}

export function useGroupedSidebarSessionListData(input: {
  agentsWithProjects: readonly SidebarSessionAgentProject[];
  expandedProjects: ReadonlySet<string>;
  serverId: string | null;
}): readonly SidebarSessionListItem[] {
  const groupedSessions = useMemo(
    () =>
      deriveGroupedSidebarSessions({
        agentsWithProjects: input.agentsWithProjects,
        expandedProjects: input.expandedProjects,
        limit: GROUPED_SESSION_LIMIT,
      }),
    [input.agentsWithProjects, input.expandedProjects],
  );

  return useMemo(
    () => flattenGroupedSidebarSessions(groupedSessions, input.serverId),
    [groupedSessions, input.serverId],
  );
}

function flattenGroupedSidebarSessions(
  groupedSessions: readonly SidebarSessionGroup[],
  serverId: string | null,
): readonly SidebarSessionListItem[] {
  if (!serverId) {
    return [];
  }

  const items: SidebarSessionListItem[] = [];
  for (const group of groupedSessions) {
    items.push({
      kind: "header",
      projectKey: group.projectKey,
      projectName: group.projectName,
      projectIconKey: group.projectIconKey,
    });
    for (const id of group.visibleIds) {
      items.push({ kind: "row", id, serverId });
    }
    if (group.totalCount > GROUPED_SESSION_LIMIT) {
      items.push({
        kind: "footer",
        projectKey: group.projectKey,
        hiddenCount: group.hiddenCount,
        isExpanded: group.isExpanded,
      });
    }
  }
  return items;
}

export const SidebarSessionGroupHeader = memo(function SidebarSessionGroupHeader({
  serverId,
  projectName,
  projectIconKey,
}: {
  serverId: string | null;
  projectName: string;
  projectIconKey: string | null;
}): ReactElement {
  const { icon } = useProjectIconQuery({ serverId: serverId ?? "", cwd: projectIconKey ?? "" });
  const dataUri = useMemo(() => {
    if (!icon || !icon.mimeType || !icon.data) {
      return null;
    }
    return `data:${icon.mimeType};base64,${icon.data}`;
  }, [icon]);

  return (
    <View style={styles.projectRow}>
      <SidebarProjectRowVisual projectName={projectName} iconDataUri={dataUri} />
    </View>
  );
});

export const SidebarSessionGroupFooter = memo(function SidebarSessionGroupFooter({
  projectKey,
  hiddenCount,
  isExpanded,
  onPress,
}: {
  projectKey: string;
  hiddenCount: number;
  isExpanded: boolean;
  onPress: (projectKey: string) => void;
}): ReactElement {
  const handlePress = useCallback(() => {
    onPress(projectKey);
  }, [onPress, projectKey]);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={isExpanded ? "Show less sessions" : `Show ${hiddenCount} more sessions`}
      onPress={handlePress}
      style={styles.footerRow}
      testID={`sidebar-session-group-footer-${projectKey}`}
    >
      <View style={styles.footerIconColumn} />
      <Text style={styles.footerText}>{isExpanded ? "Show less" : `Show ${hiddenCount} more`}</Text>
    </Pressable>
  );
});

const styles = StyleSheet.create((theme) => ({
  projectRow: {
    minHeight: 36,
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.lg,
    marginBottom: theme.spacing[1],
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
    userSelect: "none",
  },
  footerRow: {
    minHeight: 36,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.lg,
    marginBottom: theme.spacing[1],
  },
  footerIconColumn: {
    width: theme.iconSize.md,
    height: theme.iconSize.md,
    flexShrink: 0,
  },
  footerText: {
    flex: 1,
    minWidth: 0,
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
}));
