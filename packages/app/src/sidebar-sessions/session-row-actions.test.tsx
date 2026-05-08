/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import type { DaemonClient } from "@server/client/daemon-client";
import React from "react";
import { Pressable, Text, View } from "react-native";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSessionStore, type Agent, type WorkspaceDescriptor } from "@/stores/session-store";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { SidebarSessionRowKebabMenu } from "./session-row-actions";

vi.hoisted(() => {
  Object.assign(globalThis, { __DEV__: false });
});

const {
  archiveAgentMock,
  confirmDialogMock,
  platformState,
  closeTabMock,
  hideAgentMock,
  unpinAgentMock,
} = vi.hoisted(() => ({
  archiveAgentMock: vi.fn(),
  confirmDialogMock: vi.fn(),
  platformState: { isNative: false },
  closeTabMock: vi.fn(),
  hideAgentMock: vi.fn(),
  unpinAgentMock: vi.fn(),
}));

vi.mock("@/hooks/use-archive-agent", () => ({
  useArchiveAgent: () => ({
    archiveAgent: archiveAgentMock,
    isArchivingAgent: () => false,
  }),
}));

vi.mock("@/utils/confirm-dialog", () => ({
  confirmDialog: confirmDialogMock,
}));

vi.mock("@/constants/platform", () => ({
  get isNative() {
    return platformState.isNative;
  },
}));

vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <View>{children}</View>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <View>{children}</View>,
  DropdownMenuItem: ({
    children,
    onSelect,
    testID,
  }: {
    children: React.ReactNode;
    onSelect?: () => void;
    testID?: string;
  }) => (
    <Pressable testID={testID} onPress={onSelect}>
      <Text>{children}</Text>
    </Pressable>
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

vi.mock("lucide-react-native", () => {
  const createIcon = (name: string) =>
    function Icon({ uniProps: _uniProps, ...props }: Record<string, unknown>) {
      return React.createElement("span", { ...props, "data-icon": name });
    };
  return {
    Archive: createIcon("Archive"),
    MoreVertical: createIcon("MoreVertical"),
    X: createIcon("X"),
  };
});

vi.mock("react-native-unistyles", () => ({
  StyleSheet: {
    create: (styles: unknown) =>
      typeof styles === "function"
        ? styles({
            colors: {
              foreground: "#111111",
              foregroundMuted: "#666666",
              surface2: "#eeeeee",
            },
            fontSize: { xs: 12 },
          })
        : styles,
  },
  withUnistyles: (Component: React.ComponentType<Record<string, unknown>>) =>
    function ThemedComponent(props: Record<string, unknown>) {
      return <Component {...props} />;
    },
}));

const SERVER_ID = "server-1";
const WORKSPACE_ID = "workspace-1";
const AGENT_ID = "agent-1";
const CWD = "/repo/project/workspace";
const TIMESTAMP = new Date("2026-05-08T10:00:00.000Z");

const AGENT_DEFAULTS: Agent = {
  serverId: SERVER_ID,
  id: AGENT_ID,
  provider: "codex",
  status: "idle",
  createdAt: TIMESTAMP,
  updatedAt: TIMESTAMP,
  lastUserMessageAt: null,
  lastActivityAt: TIMESTAMP,
  capabilities: {
    supportsStreaming: true,
    supportsSessionPersistence: true,
    supportsDynamicModes: true,
    supportsMcpServers: true,
    supportsReasoningStream: true,
    supportsToolInvocations: true,
  },
  currentModeId: null,
  availableModes: [],
  pendingPermissions: [],
  persistence: null,
  runtimeInfo: undefined,
  lastUsage: undefined,
  lastError: null,
  title: "Menu agent",
  cwd: CWD,
  model: null,
  thinkingOptionId: undefined,
  requiresAttention: false,
  attentionReason: null,
  attentionTimestamp: null,
  archivedAt: null,
  labels: {},
  projectPlacement: null,
};

function makeAgent(input: Partial<Agent> = {}): Agent {
  return { ...AGENT_DEFAULTS, ...input };
}

function workspace(input: Partial<WorkspaceDescriptor> = {}): WorkspaceDescriptor {
  return {
    id: WORKSPACE_ID,
    projectId: "project-1",
    projectDisplayName: "Project",
    projectRootPath: "/repo/project",
    workspaceDirectory: CWD,
    projectKind: "git",
    workspaceKind: "worktree",
    name: "workspace",
    status: "done",
    archivingAt: null,
    diffStat: null,
    scripts: [],
    ...input,
  };
}

function seedState(agent: Agent = makeAgent()) {
  useSessionStore.getState().initializeSession(SERVER_ID, {} as unknown as DaemonClient);
  useSessionStore.getState().setAgents(SERVER_ID, new Map([[agent.id, agent]]));
  useSessionStore.getState().setWorkspaces(SERVER_ID, new Map([[WORKSPACE_ID, workspace()]]));
}

beforeEach(() => {
  archiveAgentMock.mockReset();
  archiveAgentMock.mockResolvedValue(undefined);
  confirmDialogMock.mockReset();
  confirmDialogMock.mockResolvedValue(true);
  closeTabMock.mockReset();
  hideAgentMock.mockReset();
  unpinAgentMock.mockReset();
  platformState.isNative = false;
  useWorkspaceLayoutStore.setState({
    closeTab: closeTabMock,
    hideAgent: hideAgentMock,
    unpinAgent: unpinAgentMock,
  });
});

afterEach(() => {
  cleanup();
  useSessionStore.setState({ sessions: {}, agentLastActivity: new Map() });
});

describe("SidebarSessionRowKebabMenu", () => {
  it("renders when hovered and hides on non-touch idle rows", () => {
    const hidden = render(
      <SidebarSessionRowKebabMenu serverId={SERVER_ID} agentId={AGENT_ID} isHovered={false} />,
    );
    expect(hidden.queryByTestId(`sidebar-session-kebab-${SERVER_ID}-${AGENT_ID}`)).toBeNull();
    hidden.unmount();

    const visible = render(
      <SidebarSessionRowKebabMenu serverId={SERVER_ID} agentId={AGENT_ID} isHovered />,
    );
    expect(visible.getByTestId(`sidebar-session-kebab-${SERVER_ID}-${AGENT_ID}`)).toBeTruthy();
  });

  it("renders on touch platforms without hover", () => {
    platformState.isNative = true;

    const { getByTestId } = render(
      <SidebarSessionRowKebabMenu serverId={SERVER_ID} agentId={AGENT_ID} isHovered={false} />,
    );

    expect(getByTestId(`sidebar-session-kebab-${SERVER_ID}-${AGENT_ID}`)).toBeTruthy();
  });

  it("archives the agent from the archive item", () => {
    const { getByTestId } = render(
      <SidebarSessionRowKebabMenu serverId={SERVER_ID} agentId={AGENT_ID} isHovered />,
    );

    fireEvent.click(getByTestId(`sidebar-session-menu-${SERVER_ID}-${AGENT_ID}-archive`));

    expect(archiveAgentMock).toHaveBeenCalledWith({ serverId: SERVER_ID, agentId: AGENT_ID });
  });

  it("uses the existing close semantics for the close item", async () => {
    seedState(makeAgent({ status: "running" }));

    const { getByTestId } = render(
      <SidebarSessionRowKebabMenu serverId={SERVER_ID} agentId={AGENT_ID} isHovered />,
    );

    fireEvent.click(getByTestId(`sidebar-session-menu-${SERVER_ID}-${AGENT_ID}-close`));

    await waitFor(() => {
      expect(archiveAgentMock).toHaveBeenCalledWith({ serverId: SERVER_ID, agentId: AGENT_ID });
    });
    expect(confirmDialogMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Archive running agent?",
        confirmLabel: "Archive",
      }),
    );
    expect(unpinAgentMock).toHaveBeenCalledWith(`${SERVER_ID}:${WORKSPACE_ID}`, AGENT_ID);
    expect(hideAgentMock).toHaveBeenCalledWith(`${SERVER_ID}:${WORKSPACE_ID}`, AGENT_ID);
    expect(closeTabMock).toHaveBeenCalledWith(`${SERVER_ID}:${WORKSPACE_ID}`, `agent_${AGENT_ID}`);
  });
});
