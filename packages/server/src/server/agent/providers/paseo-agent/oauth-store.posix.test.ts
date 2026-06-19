// POSIX-only: file mode bits are not represented the same way on Windows.
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { isPlatform } from "../../../../test-utils/platform.js";
import { loginAndStoreCodex, loginAndStoreCodexBrowser } from "./oauth-store.js";

describe.skipIf(isPlatform("win32"))("oauth-store POSIX-only", () => {
  let home: string;
  let env: NodeJS.ProcessEnv;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "paseo-oauth-store-"));
    env = { PASEO_HOME: home };
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  it("stores device-code credentials in a private file", async () => {
    const login = async () => ({ refresh: "rt-from-login", access: "ac", expires: 123 });

    const { path } = await loginAndStoreCodex({
      providerInstance: "chatgpt",
      env,
      onDeviceCode: () => {},
      login,
    });

    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it("stores browser-login credentials in a private file", async () => {
    const login = async (opts: { onAuth: (info: { url: string }) => void }) => {
      opts.onAuth({ url: "https://auth.openai.com/oauth/authorize?x=1" });
      return { refresh: "rt-browser", access: "ac", expires: 456 };
    };

    const { path } = await loginAndStoreCodexBrowser({
      providerInstance: "chatgpt",
      env,
      onAuthUrl: () => {},
      login,
    });

    expect(statSync(path).mode & 0o777).toBe(0o600);
  });
});
