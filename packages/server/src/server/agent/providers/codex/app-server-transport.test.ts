import { describe, expect, test } from "vitest";

import { createTestLogger } from "../../../../test-utils/test-logger.js";
import { CodexAppServerClient } from "./app-server-transport.js";
import { TestCodexAppServerPeer } from "./test-utils/test-app-server-peer.js";

describe("Codex app-server transport", () => {
  test("ignores non-JSON stdout lines without dropping pending requests", async () => {
    const peer = new TestCodexAppServerPeer();
    const client = new CodexAppServerClient(peer.child, createTestLogger());

    const request = client.request("model/list", {});
    peer.writeNonJsonStdout("Codex ha iniciado en modo localizado");
    peer.writeResponse(1, { data: [] });

    await expect(request).resolves.toEqual({ data: [] });
    peer.close();
  });

  test.each([
    "item/commandExecution/requestApproval",
    "item/fileChange/requestApproval",
    "item/tool/requestUserInput",
    "tool/requestUserInput",
  ])("answers server-initiated %s requests through registered handlers", async (method) => {
    const peer = new TestCodexAppServerPeer();
    const client = new CodexAppServerClient(peer.child, createTestLogger());
    const handlerCalls: unknown[] = [];
    client.setRequestHandler(method, async (params) => {
      handlerCalls.push(params);
      return { ok: true };
    });

    const response = peer.nextPaseoOutputLine();
    peer.writeRequest(method);

    await expect(response).resolves.toBe('{"id":7,"result":{"ok":true}}\n');
    expect(handlerCalls).toEqual([{}]);
    peer.close();
  });
});
