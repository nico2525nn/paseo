/**
 * @vitest-environment jsdom
 */
import { cleanup, render } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Pressable, View } from "react-native";
import { SidebarProjectTrailingActions } from "./sidebar-project-trailing-actions";

vi.hoisted(() => {
  Object.assign(globalThis, { __DEV__: false });
});

vi.mock("expo-router", () => ({
  router: {
    navigate: vi.fn(),
  },
}));

vi.mock("lucide-react-native", () => {
  const createIcon = (name: string) => (props: Record<string, unknown>) =>
    React.createElement("span", { ...props, "data-icon": name });
  return {
    FolderPlus: createIcon("FolderPlus"),
    MoreVertical: createIcon("MoreVertical"),
    Settings: createIcon("Settings"),
    Trash2: createIcon("Trash2"),
  };
});

vi.mock("react-native-unistyles", () => ({
  StyleSheet: {
    create: (styles: unknown) =>
      typeof styles === "function"
        ? styles({
            borderRadius: { md: 6 },
            colors: {
              foreground: "#111111",
              foregroundMuted: "#666666",
              surface2: "#eeeeee",
              surfaceSidebarHover: "#f5f5f5",
            },
            fontSize: { sm: 14 },
            spacing: { 2: 8 },
          })
        : styles,
  },
  withUnistyles: (Component: React.ComponentType<Record<string, unknown>>) =>
    function ThemedComponent(props: Record<string, unknown>) {
      return <Component {...props} />;
    },
}));

vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <View>{children}</View>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <View>{children}</View>,
  DropdownMenuItem: ({ children, testID }: { children: React.ReactNode; testID?: string }) => (
    <View testID={testID}>{children}</View>
  ),
  DropdownMenuTrigger: ({
    children,
    testID,
  }: {
    children: React.ReactNode | ((state: { hovered: boolean }) => React.ReactNode);
    testID?: string;
  }) => (
    <Pressable testID={testID}>
      {typeof children === "function" ? children({ hovered: false }) : children}
    </Pressable>
  ),
}));

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <View>{children}</View>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => <View>{children}</View>,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("@/components/ui/shortcut", () => ({
  Shortcut: () => <View />,
}));

vi.mock("@/constants/platform", () => ({
  isNative: false,
}));

vi.mock("@/constants/layout", () => ({
  useIsCompactFormFactor: () => false,
}));

vi.mock("@/contexts/toast-context", () => ({
  useToast: () => ({ error: vi.fn() }),
}));

vi.mock("@/hooks/use-shortcut-keys", () => ({
  useShortcutKeys: () => null,
}));

afterEach(() => {
  cleanup();
});

describe("SidebarProjectTrailingActions", () => {
  it("renders the kebab and new-worktree button when requested", () => {
    const { getByTestId } = render(
      <SidebarProjectTrailingActions
        projectKey="project-a"
        projectName="Project A"
        serverId="server-1"
        isHovered
        showNewWorktreeButton
        sourceDirectory="/repo/project-a"
        onRemoveProject={vi.fn()}
      />,
    );

    expect(getByTestId("sidebar-project-kebab-project-a")).toBeTruthy();
    expect(getByTestId("sidebar-project-new-worktree-project-a")).toBeTruthy();
  });

  it("renders only the kebab when the new-worktree button is omitted", () => {
    const { getByTestId, queryByTestId } = render(
      <SidebarProjectTrailingActions
        projectKey="project-a"
        projectName="Project A"
        serverId="server-1"
        isHovered
        onRemoveProject={vi.fn()}
      />,
    );

    expect(getByTestId("sidebar-project-kebab-project-a")).toBeTruthy();
    expect(queryByTestId("sidebar-project-new-worktree-project-a")).toBeNull();
  });
});
