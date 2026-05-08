/**
 * @vitest-environment jsdom
 */
import { act, fireEvent, render, renderHook } from "@testing-library/react";
import React from "react";
import { useCallback, useMemo } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { shallow } from "zustand/shallow";
import { useStoreWithEqualityFn } from "zustand/traditional";
import type { DaemonClient } from "@server/client/daemon-client";
import { useSessionStore, type Agent } from "@/stores/session-store";
import {
  SidebarSessionGroupFooter,
  useGroupedSidebarSessionListData,
  useOrderedAgentProjectShape,
} from "./grouped-view";
import { selectSidebarSessionSlice } from "./select-sidebar-session-slice";

vi.hoisted(() => {
  Object.assign(globalThis, { __DEV__: false });
});

vi.mock("@/hooks/use-project-icon-query", () => ({
  useProjectIconQuery: () => ({ icon: null, isLoading: false, isError: false }),
}));

const TIMESTAMP = new Date("2026-05-08T10:00:00.000Z");
const SERVER_ID = "server-1";

vi.mock("react-native-unistyles", () => ({
  StyleSheet: {
    create: (styles: unknown) =>
      typeof styles === "function"
        ? styles({
            borderRadius: { lg: 8, sm: 4 },
            colors: {
              border: "#dddddd",
              foreground: "#111111",
              foregroundMuted: "#666666",
            },
            fontSize: { sm: 14 },
            iconSize: { md: 20 },
            spacing: { 1: 4, 2: 8 },
          })
        : styles,
  },
}));

const AGENT_DEFAULTS: Agent = {
  serverId: "server-1",
  id: "agent-1",
  provider: "codex",
  status: "running",
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
  title: "Agent",
  cwd: "/repo/main",
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

function seedAgent(agent: Agent) {
  useSessionStore.getState().initializeSession(SERVER_ID, {} as unknown as DaemonClient);
  useSessionStore.getState().setAgents(SERVER_ID, new Map([[agent.id, agent]]));
}

function seedAgents(agents: Agent[]) {
  useSessionStore.getState().initializeSession(SERVER_ID, {} as unknown as DaemonClient);
  useSessionStore
    .getState()
    .setAgents(SERVER_ID, new Map(agents.map((agent) => [agent.id, agent])));
}

function useGroupedBoundaryHarness() {
  const orderedIds = useStoreWithEqualityFn(
    useSessionStore,
    (state) => Array.from(state.sessions[SERVER_ID]?.agents?.keys() ?? []),
    shallow,
  );
  const resolveCwdToProject = useCallback((cwd: string) => {
    if (cwd === "/repo/b") {
      return { projectKey: "project-b", projectName: "Project B", projectIconKey: "/repo/b" };
    }
    return { projectKey: "project-a", projectName: "Project A", projectIconKey: "/repo/a" };
  }, []);
  const agentsWithProjects = useOrderedAgentProjectShape({
    orderedIds,
    serverId: SERVER_ID,
    resolveCwdToProject,
  });
  const expandedProjects = useMemo(() => new Set<string>(), []);

  return useGroupedSidebarSessionListData({
    agentsWithProjects,
    expandedProjects,
    serverId: SERVER_ID,
  });
}

afterEach(() => {
  useSessionStore.setState({ sessions: {}, agentLastActivity: new Map() });
});

describe("sidebar session render boundaries", () => {
  it("changes the row slice when lastActivityAt changes", () => {
    const beforeAgent = makeAgent();
    seedAgent(beforeAgent);

    const beforeSlice = selectSidebarSessionSlice(
      useSessionStore.getState(),
      "server-1",
      "agent-1",
    );

    const afterAgent = makeAgent({
      lastActivityAt: new Date("2026-05-08T11:00:00.000Z"),
    });
    useSessionStore.getState().setAgents("server-1", new Map([["agent-1", afterAgent]]));

    const afterSlice = selectSidebarSessionSlice(useSessionStore.getState(), "server-1", "agent-1");

    expect(shallow(beforeSlice, afterSlice)).toBe(false);
  });

  it("does not change the row slice for fields the row does not consume", () => {
    seedAgent(makeAgent());

    const beforeSlice = selectSidebarSessionSlice(
      useSessionStore.getState(),
      "server-1",
      "agent-1",
    );

    useSessionStore.getState().setAgents(
      "server-1",
      new Map([
        [
          "agent-1",
          makeAgent({
            status: "idle",
            createdAt: new Date("2026-05-08T11:00:00.000Z"),
            requiresAttention: true,
          }),
        ],
      ]),
    );

    const afterSlice = selectSidebarSessionSlice(useSessionStore.getState(), "server-1", "agent-1");

    expect(shallow(beforeSlice, afterSlice)).toBe(true);
  });

  it("keeps grouped flattened data stable when activity changes without reordering ids", () => {
    seedAgents([makeAgent({ id: "agent-1" }), makeAgent({ id: "agent-2", cwd: "/repo/main-2" })]);

    const { result } = renderHook(() => useGroupedBoundaryHarness());
    const beforeData = result.current;

    act(() => {
      useSessionStore.getState().setAgents(
        SERVER_ID,
        new Map([
          [
            "agent-1",
            makeAgent({
              id: "agent-1",
              lastActivityAt: new Date("2026-05-08T11:00:00.000Z"),
            }),
          ],
          ["agent-2", makeAgent({ id: "agent-2", cwd: "/repo/main-2" })],
        ]),
      );
    });

    expect(result.current).toBe(beforeData);
  });

  it("changes grouped flattened data when cwd resolves to a different project", () => {
    seedAgents([makeAgent({ id: "agent-1", cwd: "/repo/a" })]);

    const { result } = renderHook(() => useGroupedBoundaryHarness());
    const beforeData = result.current;

    act(() => {
      useSessionStore
        .getState()
        .setAgents(SERVER_ID, new Map([["agent-1", makeAgent({ id: "agent-1", cwd: "/repo/b" })]]));
    });

    expect(result.current).not.toBe(beforeData);
    expect(result.current[0]).toMatchObject({ kind: "header", projectKey: "project-b" });
  });

  it("keeps grouped flattened data stable when cwd changes but resolves to the same project", () => {
    seedAgents([makeAgent({ id: "agent-1", cwd: "/repo/a" })]);

    const { result } = renderHook(() => useGroupedBoundaryHarness());
    const beforeData = result.current;

    act(() => {
      useSessionStore
        .getState()
        .setAgents(
          SERVER_ID,
          new Map([["agent-1", makeAgent({ id: "agent-1", cwd: "/repo/a-worktree" })]]),
        );
    });

    expect(result.current).toBe(beforeData);
  });

  it("calls the grouped footer press handler with its project key", () => {
    const onPress = vi.fn();

    const { getByTestId } = render(
      <SidebarSessionGroupFooter
        projectKey="project-a"
        hiddenCount={2}
        isExpanded={false}
        onPress={onPress}
      />,
    );

    fireEvent.click(getByTestId("sidebar-session-group-footer-project-a"));

    expect(onPress).toHaveBeenCalledWith("project-a");
  });
});
