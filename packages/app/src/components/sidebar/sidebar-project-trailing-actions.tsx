import React, { useCallback, useState, type ReactElement } from "react";
import {
  ActivityIndicator,
  Pressable,
  Text,
  View,
  type GestureResponderEvent,
  type PressableStateCallbackType,
} from "react-native";
import { router, type Href } from "expo-router";
import { FolderPlus, MoreVertical, Settings, Trash2 } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Shortcut } from "@/components/ui/shortcut";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { isNative as platformIsNative } from "@/constants/platform";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useToast } from "@/contexts/toast-context";
import {
  clearWorkspaceArchivePending,
  markWorkspaceArchivePending,
} from "@/contexts/session-workspace-upserts";
import { useShortcutKeys } from "@/hooks/use-shortcut-keys";
import type { SidebarWorkspaceEntry } from "@/hooks/use-sidebar-workspaces-list";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { useSessionStore, type WorkspaceDescriptor } from "@/stores/session-store";
import type { Theme } from "@/styles/theme";
import { confirmDialog } from "@/utils/confirm-dialog";
import { buildHostNewWorkspaceRoute, buildProjectSettingsRoute } from "@/utils/host-routes";
import { resolveWorkspaceMapKeyByIdentity } from "@/utils/workspace-execution";

export interface SidebarProjectTrailingActionsProps {
  projectKey: string;
  serverId: string | null;
  isHovered: boolean;
  showNewWorktreeButton?: boolean;
  projectName?: string;
  sourceDirectory?: string;
  isProjectActive?: boolean;
  onWorkspacePress?: () => void;
  onRemoveProject?: () => void;
  removeProjectStatus?: "idle" | "pending" | "success";
  workspaces?: readonly SidebarWorkspaceEntry[];
}

const ThemedActivityIndicator = withUnistyles(ActivityIndicator);
const ThemedFolderPlus = withUnistyles(FolderPlus);
const ThemedMoreVertical = withUnistyles(MoreVertical);
const ThemedSettings = withUnistyles(Settings);
const ThemedTrash2 = withUnistyles(Trash2);

const foregroundColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });
const foregroundMutedColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});

const trash2LeadingIcon = <ThemedTrash2 size={14} uniProps={foregroundMutedColorMapping} />;
const settingsLeadingIcon = <ThemedSettings size={14} uniProps={foregroundMutedColorMapping} />;

export function SidebarProjectTrailingActions({
  projectKey,
  serverId,
  isHovered,
  showNewWorktreeButton = false,
  projectName,
  sourceDirectory,
  isProjectActive = false,
  onWorkspacePress,
  onRemoveProject,
  removeProjectStatus,
  workspaces = [],
}: SidebarProjectTrailingActionsProps): ReactElement {
  const isMobileBreakpoint = useIsCompactFormFactor();
  const actionsVisible = isHovered || platformIsNative || isMobileBreakpoint;
  const fallbackRemoval = useSidebarProjectRemoval({
    projectKey,
    projectName,
    serverId,
    workspaces,
  });
  const resolvedRemoveProject = onRemoveProject ?? fallbackRemoval.onRemoveProject;
  const resolvedRemoveProjectStatus = removeProjectStatus ?? fallbackRemoval.removeProjectStatus;

  const handleBeginWorkspaceSetup = useCallback(() => {
    if (!serverId || !sourceDirectory) {
      return;
    }
    router.navigate(
      buildHostNewWorkspaceRoute(serverId, sourceDirectory, { displayName: projectName }) as Href,
    );
    onWorkspacePress?.();
  }, [onWorkspacePress, projectName, serverId, sourceDirectory]);

  return (
    <View style={styles.projectTrailingActions}>
      {showNewWorktreeButton && serverId && sourceDirectory ? (
        <NewWorktreeButton
          displayName={projectName ?? projectKey}
          onPress={handleBeginWorkspaceSetup}
          visible={actionsVisible}
          showShortcutHint={isProjectActive}
          testID={`sidebar-project-new-worktree-${projectKey}`}
        />
      ) : null}
      <View
        style={!actionsVisible && styles.projectKebabButtonHidden}
        pointerEvents={actionsVisible ? "auto" : "none"}
      >
        <ProjectKebabMenu
          projectKey={projectKey}
          onRemoveProject={resolvedRemoveProject}
          removeProjectStatus={resolvedRemoveProjectStatus}
        />
      </View>
    </View>
  );
}

function useSidebarProjectRemoval({
  projectKey,
  projectName,
  serverId,
  workspaces,
}: {
  projectKey: string;
  projectName?: string;
  serverId: string | null;
  workspaces: readonly SidebarWorkspaceEntry[];
}): {
  onRemoveProject: () => void;
  removeProjectStatus: "idle" | "pending";
} {
  const toast = useToast();
  const [isRemovingProject, setIsRemovingProject] = useState(false);
  const displayName = projectName ?? projectKey;

  const handleRemoveProject = useCallback(() => {
    if (isRemovingProject || !serverId) {
      return;
    }

    void (async () => {
      const confirmed = await confirmDialog({
        title: "Remove project?",
        message: `Remove "${displayName}" from the sidebar?\n\nFiles on disk will not be changed.`,
        confirmLabel: "Remove",
        cancelLabel: "Cancel",
        destructive: true,
      });
      if (!confirmed) {
        return;
      }

      const client = getHostRuntimeStore().getClient(serverId);
      if (!client) {
        toast.error("Host is not connected");
        return;
      }

      setIsRemovingProject(true);
      const snapshots = new Map(
        workspaces.map((workspace) => [
          workspace.workspaceId,
          hideWorkspaceOptimistically(workspace),
        ]),
      );

      const isRejected = (r: PromiseSettledResult<unknown>) => r.status === "rejected";
      void Promise.allSettled(
        workspaces.map(async (ws) => {
          try {
            const payload = await client.archiveWorkspace(ws.workspaceId);
            if (payload.error) {
              throw new Error(payload.error);
            }
          } catch (error) {
            restoreOptimisticallyHiddenWorkspace({
              serverId,
              workspaceId: ws.workspaceId,
              snapshot: snapshots.get(ws.workspaceId) ?? null,
            });
            throw error;
          }
        }),
      ).then((results) => {
        const failed = results.filter(isRejected);
        if (failed.length > 0) {
          toast.error("Failed to remove some workspaces");
        }
        setIsRemovingProject(false);
        return;
      });
    })();
  }, [displayName, isRemovingProject, serverId, toast, workspaces]);

  return {
    onRemoveProject: handleRemoveProject,
    removeProjectStatus: isRemovingProject ? "pending" : "idle",
  };
}

function hideWorkspaceOptimistically(workspace: SidebarWorkspaceEntry): WorkspaceDescriptor | null {
  const workspaces = useSessionStore.getState().sessions[workspace.serverId]?.workspaces;
  const workspaceKey = resolveWorkspaceMapKeyByIdentity({
    workspaces,
    workspaceId: workspace.workspaceId,
  });
  const snapshot = workspaceKey ? (workspaces?.get(workspaceKey) ?? null) : null;
  markWorkspaceArchivePending({
    serverId: workspace.serverId,
    workspaceId: workspace.workspaceId,
    workspaceDirectory: workspace.workspaceDirectory,
  });
  useSessionStore.getState().removeWorkspace(workspace.serverId, workspace.workspaceId);
  return snapshot;
}

function restoreOptimisticallyHiddenWorkspace(input: {
  serverId: string;
  workspaceId: string;
  snapshot: WorkspaceDescriptor | null;
}): void {
  clearWorkspaceArchivePending({
    serverId: input.serverId,
    workspaceId: input.workspaceId,
  });
  if (input.snapshot) {
    useSessionStore.getState().mergeWorkspaces(input.serverId, [input.snapshot]);
  }
}

function projectKebabStyle({
  hovered = false,
}: PressableStateCallbackType & { hovered?: boolean }) {
  return [styles.projectKebabButton, hovered && styles.projectKebabButtonHovered];
}

function renderKebabTriggerIcon({ hovered }: { hovered?: boolean }) {
  return (
    <ThemedMoreVertical
      size={14}
      uniProps={hovered ? foregroundColorMapping : foregroundMutedColorMapping}
    />
  );
}

function ProjectKebabMenu({
  projectKey,
  onRemoveProject,
  removeProjectStatus,
}: {
  projectKey: string;
  onRemoveProject: () => void;
  removeProjectStatus: "idle" | "pending" | "success";
}) {
  const handleOpenProjectSettings = useCallback(() => {
    if (projectKey.trim().length === 0) return;
    router.navigate(buildProjectSettingsRoute(projectKey));
  }, [projectKey]);
  const canOpenProjectSettings = projectKey.trim().length > 0;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        hitSlop={8}
        style={projectKebabStyle}
        accessibilityRole="button"
        accessibilityLabel="Project actions"
        testID={`sidebar-project-kebab-${projectKey}`}
      >
        {renderKebabTriggerIcon}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" width={220}>
        {canOpenProjectSettings ? (
          <DropdownMenuItem
            testID={`sidebar-project-menu-open-settings-${projectKey}`}
            leading={settingsLeadingIcon}
            onSelect={handleOpenProjectSettings}
          >
            Open project settings
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem
          testID={`sidebar-project-menu-remove-${projectKey}`}
          leading={trash2LeadingIcon}
          status={removeProjectStatus}
          pendingLabel="Removing..."
          onSelect={onRemoveProject}
        >
          Remove project
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function NewWorktreeButton({
  displayName,
  onPress,
  visible,
  loading = false,
  testID,
  showShortcutHint = false,
}: {
  displayName: string;
  onPress: () => void;
  visible: boolean;
  loading?: boolean;
  testID: string;
  showShortcutHint?: boolean;
}) {
  const newWorktreeKeys = useShortcutKeys("new-worktree");

  const pressableStyle = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.projectIconActionButton,
      !visible && styles.projectIconActionButtonHidden,
      (Boolean(hovered) || pressed) && !loading && styles.projectIconActionButtonHovered,
    ],
    [visible, loading],
  );

  const handlePress = useCallback(
    (event: GestureResponderEvent) => {
      event.stopPropagation();
      onPress();
    },
    [onPress],
  );

  return (
    <View style={styles.projectTrailingControlSlot} pointerEvents={visible ? "auto" : "none"}>
      <Tooltip delayDuration={0} enabledOnDesktop enabledOnMobile={false}>
        <TooltipTrigger asChild disabled={!visible}>
          <Pressable
            style={pressableStyle}
            onPress={handlePress}
            disabled={loading}
            accessibilityRole="button"
            accessibilityLabel={`Create a new workspace for ${displayName}`}
            testID={testID}
          >
            {({ hovered, pressed }) =>
              loading ? (
                <ThemedActivityIndicator size={14} uniProps={foregroundMutedColorMapping} />
              ) : (
                <ThemedFolderPlus
                  size={15}
                  uniProps={
                    hovered || pressed ? foregroundColorMapping : foregroundMutedColorMapping
                  }
                />
              )
            }
          </Pressable>
        </TooltipTrigger>
        <TooltipContent side="bottom" align="center" offset={8}>
          <View style={styles.projectActionTooltipRow}>
            <Text style={styles.projectActionTooltipText}>New workspace</Text>
            {showShortcutHint && newWorktreeKeys ? (
              <Shortcut chord={newWorktreeKeys} style={styles.projectActionTooltipShortcut} />
            ) : null}
          </View>
        </TooltipContent>
      </Tooltip>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  projectIconActionButton: {
    width: 24,
    height: 24,
    borderRadius: theme.borderRadius.md,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  projectIconActionButtonHovered: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  projectIconActionButtonHidden: {
    opacity: 0,
  },
  projectTrailingActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    flexShrink: 0,
  },
  projectKebabButton: {
    width: 24,
    height: 24,
    borderRadius: theme.borderRadius.md,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  projectKebabButtonHidden: {
    opacity: 0,
  },
  projectKebabButtonHovered: {
    backgroundColor: theme.colors.surface2,
  },
  projectTrailingControlSlot: {
    width: 24,
    height: 24,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  projectActionTooltipRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  projectActionTooltipText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  projectActionTooltipShortcut: {},
}));
