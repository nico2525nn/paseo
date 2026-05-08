import React, { memo, useCallback, useMemo, useState, type ReactElement } from "react";
import {
  FlatList,
  Pressable,
  Text,
  View,
  type ListRenderItem,
  type PressableStateCallbackType,
} from "react-native";
import { useShallow } from "zustand/shallow";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { SidebarAgentListSkeleton } from "@/components/sidebar-agent-list-skeleton";
import {
  type AggregatedAgentIdEntry,
  useAggregatedAgentIds,
  useAggregatedAgentsInitialLoad,
} from "@/hooks/use-aggregated-agents";
import {
  WorkspaceTabIcon,
  WorkspaceTabPresentationResolver,
} from "@/screens/workspace/workspace-tab-presentation";
import type { WorkspaceTabDescriptor } from "@/screens/workspace/workspace-tabs-types";
import type { SidebarProjectEntry } from "@/hooks/use-sidebar-workspaces-list";
import { useSessionStore } from "@/stores/session-store";
import { navigateToPreparedWorkspaceTab, prepareWorkspaceTab } from "@/utils/workspace-navigation";
import { formatTimeAgo } from "@/utils/time";
import {
  createSidebarSessionWorkspaceLookup,
  resolveSidebarSessionWorkspaceId,
  resolveSidebarSessionWorkspace,
  shouldIncludeSidebarSessionAgent,
} from "./session-filtering";
import { selectSidebarSessionSlice } from "./select-sidebar-session-slice";
import type { ResolvedSidebarSessionProject, SidebarSessionFilter } from "./types";
import { useSidebarSessionWorkspaces } from "./use-sidebar-session-workspaces";
import {
  SidebarSessionGroupFooter,
  SidebarSessionGroupHeader,
  type SidebarSessionListItem,
  useGroupedSidebarSessionListData,
  useOrderedAgentProjectShape,
} from "./grouped-view";

interface SidebarSessionsViewProps {
  serverId: string | null;
  projects: readonly SidebarProjectEntry[];
  filter: SidebarSessionFilter;
  groupByProject: boolean;
  expandedProjects: ReadonlySet<string>;
  onProjectExpandedToggle: (projectKey: string) => void;
}

export function SidebarSessionsView({
  serverId,
  projects,
  filter,
  groupByProject,
  expandedProjects,
  onProjectExpandedToggle,
}: SidebarSessionsViewProps): ReactElement {
  const isInitialLoad = useAggregatedAgentsInitialLoad();
  const workspaces = useSidebarSessionWorkspaces({ serverId, projects });
  const lookup = useMemo(() => createSidebarSessionWorkspaceLookup(workspaces), [workspaces]);
  const filterAgent = useCallback(
    (agent: AggregatedAgentIdEntry) =>
      shouldIncludeSidebarSessionAgent({
        agent,
        filter,
        lookup,
      }),
    [filter, lookup],
  );
  const sessionIds = useAggregatedAgentIds({
    filter: filterAgent,
    sort: "createdAt-desc-stable",
  });
  const resolveCwdToProject = useCallback(
    (cwd: string) => {
      if (!serverId) {
        return null;
      }
      const workspace = resolveSidebarSessionWorkspace(lookup, {
        id: "",
        serverId,
        cwd,
        archivedAt: null,
      });
      if (!workspace) {
        return null;
      }
      return {
        projectKey: workspace.projectKey,
        projectName: workspace.projectName,
        projectIconKey: workspace.projectIconKey,
      };
    },
    [lookup, serverId],
  );

  if (isInitialLoad) {
    return <SidebarAgentListSkeleton />;
  }

  if (groupByProject) {
    return (
      <GroupedSidebarSessionsList
        serverId={serverId}
        sessionIds={sessionIds}
        resolveCwdToProject={resolveCwdToProject}
        expandedProjects={expandedProjects}
        onProjectExpandedToggle={onProjectExpandedToggle}
      />
    );
  }

  return <FlatSidebarSessionsList serverId={serverId} sessionIds={sessionIds} />;
}

const FlatSidebarSessionsList = memo(function FlatSidebarSessionsList({
  serverId,
  sessionIds,
}: {
  serverId: string | null;
  sessionIds: readonly string[];
}): ReactElement {
  const renderItem: ListRenderItem<string> = useCallback(
    ({ item }) => (serverId ? <SidebarSessionRow id={item} serverId={serverId} /> : null),
    [serverId],
  );
  const keyExtractor = useCallback((id: string) => `${serverId ?? ""}:${id}`, [serverId]);

  return (
    <FlatList
      data={sessionIds}
      style={styles.list}
      contentContainerStyle={styles.listContent}
      keyExtractor={keyExtractor}
      renderItem={renderItem}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      ListEmptyComponent={EmptySessions}
    />
  );
});

const GroupedSidebarSessionsList = memo(function GroupedSidebarSessionsList({
  serverId,
  sessionIds,
  resolveCwdToProject,
  expandedProjects,
  onProjectExpandedToggle,
}: {
  serverId: string | null;
  sessionIds: readonly string[];
  resolveCwdToProject: (cwd: string) => ResolvedSidebarSessionProject | null;
  expandedProjects: ReadonlySet<string>;
  onProjectExpandedToggle: (projectKey: string) => void;
}): ReactElement {
  const agentsWithProjects = useOrderedAgentProjectShape({
    orderedIds: sessionIds,
    serverId: serverId ?? "",
    resolveCwdToProject,
  });
  const data = useGroupedSidebarSessionListData({
    agentsWithProjects,
    expandedProjects,
    serverId,
  });

  const renderItem: ListRenderItem<SidebarSessionListItem> = useCallback(
    ({ item }) => {
      switch (item.kind) {
        case "header":
          return (
            <SidebarSessionGroupHeader
              serverId={serverId}
              projectName={item.projectName}
              projectIconKey={item.projectIconKey}
            />
          );
        case "row":
          return <SidebarSessionRow id={item.id} serverId={item.serverId} />;
        case "footer":
          return (
            <SidebarSessionGroupFooter
              projectKey={item.projectKey}
              hiddenCount={item.hiddenCount}
              isExpanded={item.isExpanded}
              onPress={onProjectExpandedToggle}
            />
          );
      }
    },
    [onProjectExpandedToggle, serverId],
  );
  const keyExtractor = useCallback((item: SidebarSessionListItem) => {
    switch (item.kind) {
      case "header":
        return `header:${item.projectKey}`;
      case "row":
        return `row:${item.id}`;
      case "footer":
        return `footer:${item.projectKey}`;
    }
  }, []);

  return (
    <FlatList
      data={data}
      style={styles.list}
      contentContainerStyle={styles.listContent}
      keyExtractor={keyExtractor}
      renderItem={renderItem}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      ListEmptyComponent={EmptySessions}
    />
  );
});

const SidebarSessionRow = memo(function SidebarSessionRow({
  id,
  serverId,
}: {
  id: string;
  serverId: string;
}): ReactElement | null {
  const { theme } = useUnistyles();
  const [isHovered, setIsHovered] = useState(false);
  const agent = useSessionStore(
    useShallow((state) => selectSidebarSessionSlice(state, serverId, id)),
  );
  const agentCwd = agent?.cwd ?? null;

  const handlePress = useCallback(() => {
    if (!agentCwd) {
      return;
    }

    const workspaceId = resolveSidebarSessionWorkspaceId({
      agent: {
        id,
        serverId,
        cwd: agentCwd,
        archivedAt: null,
      },
      workspaces: useSessionStore.getState().sessions[serverId]?.workspaces?.values(),
    });
    if (!workspaceId) {
      return;
    }

    const target = { kind: "agent" as const, agentId: id };
    prepareWorkspaceTab({
      serverId,
      workspaceId,
      target,
    });
    navigateToPreparedWorkspaceTab({
      serverId,
      workspaceId,
      target,
    });
  }, [agentCwd, id, serverId]);

  const handlePointerEnter = useCallback(() => setIsHovered(true), []);
  const handlePointerLeave = useCallback(() => setIsHovered(false), []);

  const pressableStyle = useCallback(
    ({ pressed }: PressableStateCallbackType) => [
      styles.row,
      isHovered && styles.rowHovered,
      pressed && styles.rowPressed,
    ],
    [isHovered],
  );

  const titleStyle = useMemo(() => [styles.title, isHovered && styles.titleHovered], [isHovered]);
  const tabDescriptor = useMemo<WorkspaceTabDescriptor>(
    () => ({
      key: `agent_${id}`,
      tabId: `agent_${id}`,
      kind: "agent",
      target: { kind: "agent", agentId: id },
    }),
    [id],
  );

  if (!agent || agent.archivedAt) {
    return null;
  }

  return (
    <View onPointerEnter={handlePointerEnter} onPointerLeave={handlePointerLeave}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={agent.title || "New session"}
        onPress={handlePress}
        style={pressableStyle}
        testID={`sidebar-session-row-${serverId}-${id}`}
      >
        <View style={styles.providerIconWrap}>
          <WorkspaceTabPresentationResolver
            tab={tabDescriptor}
            serverId={serverId}
            workspaceId="sidebar-sessions"
          >
            {(presentation) => (
              <WorkspaceTabIcon
                presentation={presentation}
                active={isHovered}
                size={theme.iconSize.sm}
                statusDotBorderColor={isHovered ? theme.colors.surfaceSidebarHover : undefined}
              />
            )}
          </WorkspaceTabPresentationResolver>
        </View>
        <Text style={titleStyle} numberOfLines={1}>
          {agent.title || "New session"}
        </Text>
        <Text style={styles.timeAgo} numberOfLines={1}>
          {formatTimeAgo(agent.lastActivityAt)}
        </Text>
      </Pressable>
    </View>
  );
});

function EmptySessions(): ReactElement {
  return (
    <View style={styles.emptyState}>
      <Text style={styles.emptyText}>No sessions</Text>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  list: {
    flex: 1,
    minHeight: 0,
  },
  listContent: {
    paddingHorizontal: theme.spacing[2],
    paddingTop: theme.spacing[2],
    paddingBottom: theme.spacing[4],
  },
  row: {
    minHeight: 36,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.lg,
    marginBottom: theme.spacing[1],
  },
  rowHovered: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  rowPressed: {
    backgroundColor: theme.colors.surface2,
  },
  providerIconWrap: {
    width: theme.iconSize.md,
    height: theme.iconSize.md,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  title: {
    flex: 1,
    minWidth: 0,
    fontSize: theme.fontSize.sm,
    fontWeight: "400",
    lineHeight: 20,
    color: theme.colors.foreground,
    opacity: 0.76,
  },
  titleHovered: {
    opacity: 1,
  },
  timeAgo: {
    flexShrink: 0,
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
  emptyState: {
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[6],
  },
  emptyText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
}));
