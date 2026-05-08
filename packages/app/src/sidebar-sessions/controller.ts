import { useEffect, useRef, useState } from "react";
import type { SidebarSessionFilter, SidebarSessionViewMode } from "./types";

export function useSidebarSessionsController({ serverId }: { serverId: string | null }) {
  const previousServerIdRef = useRef(serverId);
  const [sidebarViewMode, setSidebarViewMode] = useState<SidebarSessionViewMode>("workspaces");
  const [sidebarSessionFilter, setSidebarSessionFilter] = useState<SidebarSessionFilter>({
    type: "all",
  });

  useEffect(() => {
    if (previousServerIdRef.current === serverId) {
      return;
    }
    previousServerIdRef.current = serverId;
    setSidebarSessionFilter({ type: "all" });
  }, [serverId]);

  return {
    sidebarViewMode,
    setSidebarViewMode,
    sidebarSessionFilter,
    setSidebarSessionFilter,
  };
}
