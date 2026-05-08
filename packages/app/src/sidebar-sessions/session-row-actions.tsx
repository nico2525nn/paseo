import React, { memo, useCallback, useMemo, type ReactElement } from "react";
import { Text, type PressableStateCallbackType } from "react-native";
import { Archive, MoreVertical, X } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { isNative as isTouchPlatform } from "@/constants/platform";
import { useArchiveAgent } from "@/hooks/use-archive-agent";
import {
  buildWorkspaceTabMenuEntries,
  type WorkspaceTabMenuEntry,
} from "@/screens/workspace/workspace-tab-menu";
import type { WorkspaceTabDescriptor } from "@/screens/workspace/workspace-tabs-types";
import { useSessionStore } from "@/stores/session-store";
import {
  buildWorkspaceTabPersistenceKey,
  useWorkspaceLayoutStore,
} from "@/stores/workspace-layout-store";
import type { Theme } from "@/styles/theme";
import { confirmDialog } from "@/utils/confirm-dialog";
import { resolveSidebarSessionWorkspaceId } from "./session-filtering";

export interface SidebarSessionRowKebabMenuProps {
  serverId: string;
  agentId: string;
  isHovered: boolean;
}

const ThemedArchive = withUnistyles(Archive);
const ThemedMoreVertical = withUnistyles(MoreVertical);
const ThemedX = withUnistyles(X);

const foregroundColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });
const foregroundMutedColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});

const archiveLeadingIcon = <ThemedArchive size={14} uniProps={foregroundMutedColorMapping} />;

function kebabButtonStyle({ hovered = false }: PressableStateCallbackType & { hovered?: boolean }) {
  return [styles.kebabButton, hovered && styles.kebabButtonHovered];
}

function renderKebabTriggerIcon({ hovered }: { hovered?: boolean }) {
  return (
    <ThemedMoreVertical
      size={14}
      uniProps={hovered ? foregroundColorMapping : foregroundMutedColorMapping}
    />
  );
}

function noop() {}

export const SidebarSessionRowKebabMenu = memo(function SidebarSessionRowKebabMenu({
  serverId,
  agentId,
  isHovered,
}: SidebarSessionRowKebabMenuProps): ReactElement | null {
  const visible = isHovered || isTouchPlatform;
  const { archiveAgent } = useArchiveAgent();
  const closeWorkspaceTab = useWorkspaceLayoutStore((state) => state.closeTab);
  const unpinWorkspaceAgent = useWorkspaceLayoutStore((state) => state.unpinAgent);
  const hideWorkspaceAgent = useWorkspaceLayoutStore((state) => state.hideAgent);

  const tab = useMemo<WorkspaceTabDescriptor>(
    () => ({
      key: `agent_${agentId}`,
      tabId: `agent_${agentId}`,
      kind: "agent",
      target: { kind: "agent", agentId },
    }),
    [agentId],
  );

  const handleArchiveAgent = useCallback(() => {
    void archiveAgent({ serverId, agentId }).catch(() => {});
  }, [agentId, archiveAgent, serverId]);

  const handleCloseAgentTab = useCallback(async () => {
    const agent = useSessionStore.getState().sessions[serverId]?.agents?.get(agentId) ?? null;
    const isRunning = agent?.status === "running" || agent?.status === "initializing";

    if (isRunning) {
      const confirmed = await confirmDialog({
        title: "Archive running agent?",
        message: "This agent is still running. Archiving it will stop the agent and close the tab.",
        confirmLabel: "Archive",
        cancelLabel: "Cancel",
        destructive: true,
      });
      if (!confirmed) {
        return;
      }
    }

    const workspaceId = agent?.cwd
      ? resolveSidebarSessionWorkspaceId({
          agent: {
            id: agentId,
            serverId,
            cwd: agent.cwd,
            archivedAt: null,
          },
          workspaces: useSessionStore.getState().sessions[serverId]?.workspaces?.values(),
        })
      : null;
    const persistenceKey = workspaceId
      ? buildWorkspaceTabPersistenceKey({ serverId, workspaceId })
      : null;

    if (persistenceKey) {
      unpinWorkspaceAgent(persistenceKey, agentId);
      hideWorkspaceAgent(persistenceKey, agentId);
      closeWorkspaceTab(persistenceKey, tab.tabId);
    }

    void archiveAgent({ serverId, agentId }).catch(() => {});
  }, [
    agentId,
    archiveAgent,
    closeWorkspaceTab,
    hideWorkspaceAgent,
    serverId,
    tab.tabId,
    unpinWorkspaceAgent,
  ]);

  const closeEntry = useMemo(
    () =>
      buildWorkspaceTabMenuEntries({
        surface: "desktop",
        tab,
        index: 0,
        tabCount: 1,
        menuTestIDBase: `sidebar-session-menu-${serverId}-${agentId}`,
        onCopyResumeCommand: noop,
        onCopyAgentId: noop,
        onReloadAgent: noop,
        onCloseTab: handleCloseAgentTab,
        onCloseTabsBefore: noop,
        onCloseTabsAfter: noop,
        onCloseOtherTabs: noop,
      }).find((entry) => entry.kind === "item" && entry.key === "close") as
        | Extract<WorkspaceTabMenuEntry, { kind: "item" }>
        | undefined,
    [agentId, handleCloseAgentTab, serverId, tab],
  );

  if (!visible || !closeEntry) {
    return null;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        hitSlop={8}
        style={kebabButtonStyle}
        accessibilityRole="button"
        accessibilityLabel="Session actions"
        testID={`sidebar-session-kebab-${serverId}-${agentId}`}
      >
        {renderKebabTriggerIcon}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" width={220}>
        <SidebarSessionMenuItem entry={closeEntry} />
        <DropdownMenuItem
          testID={`sidebar-session-menu-${serverId}-${agentId}-archive`}
          leading={archiveLeadingIcon}
          onSelect={handleArchiveAgent}
        >
          Archive
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
});

function SidebarSessionMenuItem({
  entry,
}: {
  entry: Extract<WorkspaceTabMenuEntry, { kind: "item" }>;
}) {
  const leading = useMemo(() => {
    if (entry.icon === "x") {
      return <ThemedX size={14} uniProps={foregroundMutedColorMapping} />;
    }
    return undefined;
  }, [entry.icon]);
  const trailing = useMemo(
    () => (entry.hint ? <Text style={styles.menuItemHint}>{entry.hint}</Text> : undefined),
    [entry.hint],
  );

  return (
    <DropdownMenuItem
      testID={entry.testID}
      disabled={entry.disabled}
      destructive={entry.destructive}
      onSelect={entry.onSelect}
      tooltip={entry.tooltip}
      leading={leading}
      trailing={trailing}
    >
      {entry.label}
    </DropdownMenuItem>
  );
}

const styles = StyleSheet.create((theme) => ({
  kebabButton: {
    padding: 2,
    borderRadius: 4,
    marginLeft: 2,
  },
  kebabButtonHovered: {
    backgroundColor: theme.colors.surface2,
  },
  menuItemHint: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
}));
