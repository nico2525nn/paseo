import { describe, expect, test } from "vitest";
import {
  getPaseoBrowserIdForWebContents,
  registerPaseoBrowserWebContents,
  unregisterPaseoBrowser,
} from "./index.js";

class FakeRegisteredWebContents {
  public readonly backgroundThrottlingCalls: boolean[] = [];
  private destroyedListener: (() => void) | null = null;
  private destroyed = false;

  public constructor(private readonly webContentsId: number) {}

  public get id(): number {
    if (this.destroyed) {
      throw new TypeError("Object has been destroyed");
    }
    return this.webContentsId;
  }

  public isDestroyed(): boolean {
    return this.destroyed;
  }

  public setBackgroundThrottling(allowed: boolean): void {
    this.backgroundThrottlingCalls.push(allowed);
  }

  public once(event: "destroyed", listener: () => void): void {
    expect(event).toBe("destroyed");
    this.destroyedListener = listener;
  }

  public destroy(): void {
    this.destroyed = true;
    this.destroyedListener?.();
  }
}

class LiveWebContentsIdentity {
  public constructor(public readonly id: number) {}

  public isDestroyed(): boolean {
    return false;
  }
}

describe("registerPaseoBrowserWebContents", () => {
  test("disables guest background throttling once when the webview is registered", () => {
    const contents = new FakeRegisteredWebContents(9001);

    registerPaseoBrowserWebContents({
      contents,
      browserId: "browser-throttle",
      hostWebContentsId: 1001,
    });

    expect(contents.backgroundThrottlingCalls).toEqual([false]);
    expect(getPaseoBrowserIdForWebContents(contents)).toBe("browser-throttle");

    unregisterPaseoBrowser("browser-throttle");
  });

  test("unregisters a guest after Electron invalidates its wrapper", () => {
    const contents = new FakeRegisteredWebContents(9002);
    const liveIdentityWithSameId = new LiveWebContentsIdentity(9002);

    registerPaseoBrowserWebContents({
      contents,
      browserId: "browser-destroyed",
      hostWebContentsId: 1001,
    });

    expect(() => contents.destroy()).not.toThrow();

    expect(getPaseoBrowserIdForWebContents(liveIdentityWithSameId)).toBeNull();
  });
});
