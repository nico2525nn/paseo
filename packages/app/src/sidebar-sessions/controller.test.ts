/**
 * @vitest-environment jsdom
 */
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useSidebarSessionsController } from "./controller";

describe("useSidebarSessionsController", () => {
  it("resets the session filter when the active host changes", () => {
    const { result, rerender } = renderHook(
      ({ serverId }) => useSidebarSessionsController({ serverId }),
      { initialProps: { serverId: "server-1" as string | null } },
    );

    act(() => {
      result.current.setSidebarSessionFilter({
        type: "project",
        projectKey: "project-a",
      });
    });

    expect(result.current.sidebarSessionFilter).toEqual({
      type: "project",
      projectKey: "project-a",
    });

    rerender({ serverId: "server-2" });

    expect(result.current.sidebarSessionFilter).toEqual({ type: "all" });
    expect(result.current.sidebarViewMode).toBe("workspaces");
  });
});
