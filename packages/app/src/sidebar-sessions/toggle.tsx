import { Filter } from "lucide-react-native";
import { memo, useCallback, useMemo, type ReactElement } from "react";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { SidebarProjectEntry } from "@/hooks/use-sidebar-workspaces-list";
import type { SidebarSessionFilter, SidebarSessionViewMode } from "./types";
import { useVisibleSidebarSessionFilterProjects } from "./use-sidebar-session-workspaces";

interface SidebarSessionsToggleProps {
  serverId: string | null;
  mode: SidebarSessionViewMode;
  filter: SidebarSessionFilter;
  projects: readonly SidebarProjectEntry[];
  onModeChange: (mode: SidebarSessionViewMode) => void;
  onFilterChange: (filter: SidebarSessionFilter) => void;
}

export const SidebarSessionsToggle = memo(function SidebarSessionsToggle({
  serverId,
  mode,
  filter,
  projects,
  onModeChange,
  onFilterChange,
}: SidebarSessionsToggleProps): ReactElement {
  const sessionsActive = mode === "sessions";

  const handleWorkspacesPress = useCallback(() => {
    onModeChange("workspaces");
  }, [onModeChange]);
  const handleSessionsPress = useCallback(() => {
    onModeChange("sessions");
  }, [onModeChange]);

  return (
    <View style={styles.container}>
      <View style={styles.pillGroup}>
        <TogglePill
          label="Workspaces"
          active={mode === "workspaces"}
          onPress={handleWorkspacesPress}
        />
        <TogglePill label="Sessions" active={sessionsActive} onPress={handleSessionsPress} />
      </View>
      {sessionsActive ? (
        <SidebarSessionsFilterMenu
          serverId={serverId}
          filter={filter}
          projects={projects}
          onFilterChange={onFilterChange}
        />
      ) : null}
    </View>
  );
});

function SidebarSessionsFilterMenu({
  serverId,
  filter,
  projects,
  onFilterChange,
}: {
  serverId: string | null;
  filter: SidebarSessionFilter;
  projects: readonly SidebarProjectEntry[];
  onFilterChange: (filter: SidebarSessionFilter) => void;
}) {
  const { theme } = useUnistyles();
  const filterActive = filter.type !== "all";
  const filterIconColor = filterActive ? theme.colors.accentForeground : theme.colors.foreground;
  const visibleFilterProjects = useVisibleSidebarSessionFilterProjects({ serverId, projects });

  const handleAllSelect = useCallback(() => {
    onFilterChange({ type: "all" });
  }, [onFilterChange]);

  const filterTriggerStyle = useCallback(
    ({ hovered = false, open = false }: PressableStateCallbackType & { open?: boolean }) => [
      styles.filterButton,
      filterActive && styles.filterButtonActive,
      (hovered || open) && !filterActive && styles.filterButtonHovered,
    ],
    [filterActive],
  );

  const filterIcon = useMemo(
    () => <Filter size={theme.iconSize.sm} color={filterIconColor} />,
    [filterIconColor, theme.iconSize.sm],
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        accessibilityLabel="Filter sessions"
        accessibilityRole="button"
        style={filterTriggerStyle}
        testID="sidebar-sessions-filter-trigger"
      >
        {filterIcon}
        {filterActive ? <View style={styles.filterBadge} /> : null}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" width={260} scrollable maxHeight={420}>
        <DropdownMenuItem selected={filter.type === "all"} onSelect={handleAllSelect}>
          All
        </DropdownMenuItem>
        {visibleFilterProjects.length > 0 ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
            {visibleFilterProjects.flatMap((project) =>
              project.workspaces.map((workspace) => (
                <WorkspaceFilterItem
                  key={workspace.workspaceKey}
                  selected={
                    filter.type === "workspace" && filter.workspaceKey === workspace.workspaceKey
                  }
                  label={workspace.name}
                  description={project.projectName}
                  workspaceKey={workspace.workspaceKey}
                  onFilterChange={onFilterChange}
                />
              )),
            )}
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Projects</DropdownMenuLabel>
            {visibleFilterProjects.map((project) => (
              <ProjectFilterItem
                key={project.projectKey}
                selected={filter.type === "project" && filter.projectKey === project.projectKey}
                label={project.projectName}
                projectKey={project.projectKey}
                onFilterChange={onFilterChange}
              />
            ))}
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function TogglePill({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  const pillStyle = useCallback(
    ({ hovered = false }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.pill,
      active && styles.pillActive,
      hovered && !active && styles.pillHovered,
    ],
    [active],
  );
  const textStyle = useMemo(() => [styles.pillText, active && styles.pillTextActive], [active]);

  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={pillStyle}>
      <Text style={textStyle}>{label}</Text>
    </Pressable>
  );
}

function FilterItem({
  selected,
  label,
  description,
  onSelect,
}: {
  selected: boolean;
  label: string;
  description?: string;
  onSelect: () => void;
}) {
  return (
    <DropdownMenuItem selected={selected} description={description} onSelect={onSelect}>
      {label}
    </DropdownMenuItem>
  );
}

function WorkspaceFilterItem({
  selected,
  label,
  description,
  workspaceKey,
  onFilterChange,
}: {
  selected: boolean;
  label: string;
  description: string;
  workspaceKey: string;
  onFilterChange: (filter: SidebarSessionFilter) => void;
}) {
  const handleSelect = useCallback(() => {
    onFilterChange({ type: "workspace", workspaceKey });
  }, [onFilterChange, workspaceKey]);

  return (
    <FilterItem
      selected={selected}
      label={label}
      description={description}
      onSelect={handleSelect}
    />
  );
}

function ProjectFilterItem({
  selected,
  label,
  projectKey,
  onFilterChange,
}: {
  selected: boolean;
  label: string;
  projectKey: string;
  onFilterChange: (filter: SidebarSessionFilter) => void;
}) {
  const handleSelect = useCallback(() => {
    onFilterChange({ type: "project", projectKey });
  }, [onFilterChange, projectKey]);

  return <FilterItem selected={selected} label={label} onSelect={handleSelect} />;
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
    paddingHorizontal: {
      xs: theme.spacing[3],
      md: theme.spacing[4],
    },
    paddingTop: theme.spacing[3],
    paddingBottom: theme.spacing[2],
  },
  pillGroup: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    padding: 2,
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.surfaceSidebarHover,
    minWidth: 0,
  },
  pill: {
    minHeight: 28,
    justifyContent: "center",
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
  },
  pillActive: {
    backgroundColor: theme.colors.surface1,
  },
  pillHovered: {
    backgroundColor: theme.colors.surfaceSidebar,
  },
  pillText: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.foregroundMuted,
  },
  pillTextActive: {
    color: theme.colors.foreground,
  },
  filterButton: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.md,
    position: "relative",
  },
  filterButtonHovered: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  filterButtonActive: {
    backgroundColor: theme.colors.accent,
  },
  filterBadge: {
    position: "absolute",
    top: 5,
    right: 5,
    width: 5,
    height: 5,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.accentForeground,
  },
}));
