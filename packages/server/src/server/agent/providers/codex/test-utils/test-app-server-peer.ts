import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { isDeepStrictEqual } from "node:util";

interface JsonRecord {
  [key: string]: unknown;
}

type RequestHandler = (params: unknown) => unknown;
type StubbedCodexAppServerChildProcess = ChildProcessWithoutNullStreams & {
  stdin: PassThrough;
  stdout: PassThrough;
  stderr: PassThrough;
  killSignals: Array<NodeJS.Signals | number | null>;
};

function isJsonRecord(value: unknown): value is JsonRecord {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function parseJsonLine(line: string): JsonRecord | null {
  const parsed: unknown = JSON.parse(line);
  return isJsonRecord(parsed) ? parsed : null;
}

export function createCodexAppServerChildProcessStub(
  options: { exitOnKill?: boolean } = {},
): StubbedCodexAppServerChildProcess {
  const child = new EventEmitter() as StubbedCodexAppServerChildProcess;
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.killSignals = [];
  Object.defineProperty(child, "exitCode", { value: null, configurable: true });
  Object.defineProperty(child, "signalCode", { value: null, configurable: true });
  child.kill = ((signal?: NodeJS.Signals | number) => {
    child.killSignals.push(signal ?? null);
    if (options.exitOnKill !== false) {
      queueMicrotask(() => child.emit("exit", null, signal ?? null));
    }
    return true;
  }) as ChildProcessWithoutNullStreams["kill"];
  return child;
}

export class TestCodexAppServerPeer {
  readonly child: StubbedCodexAppServerChildProcess;
  private readonly messages: JsonRecord[] = [];
  private readonly errors: Error[] = [];
  private readonly waiters = new Set<{
    predicate: (message: JsonRecord) => boolean;
    resolve: (message: JsonRecord) => void;
  }>();
  private buffer = "";

  constructor(handlers: Record<string, RequestHandler> = {}) {
    this.child = createCodexAppServerChildProcessStub();
    this.child.stdin.on("data", (chunk) => {
      this.acceptPaseoOutput(chunk.toString(), handlers);
    });
  }

  writeNonJsonStdout(line: string): void {
    this.child.stdout.write(`${line}\n`);
  }

  writeResponse(id: number, result: unknown): void {
    this.child.stdout.write(`${JSON.stringify({ id, result })}\n`);
  }

  writeRequest(method: string, params: unknown = {}, id = 7): void {
    this.child.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  }

  nextPaseoOutputLine(): Promise<string> {
    return new Promise((resolve) => {
      this.child.stdin.once("data", (chunk) => resolve(chunk.toString()));
    });
  }

  async waitForResponse(id: number, result: unknown): Promise<JsonRecord> {
    return this.waitForMessage(
      (message) =>
        message.id === id && !("method" in message) && isDeepStrictEqual(message.result, result),
      `response ${id}`,
    );
  }

  assertNoErrors(): void {
    if (this.errors.length > 0) {
      throw this.errors[0];
    }
  }

  close(): void {
    this.child.stdout.end();
    this.child.stderr.end();
    this.child.stdin.end();
  }

  private acceptPaseoOutput(chunk: string, handlers: Record<string, RequestHandler>): void {
    this.buffer += chunk;
    for (;;) {
      const newlineIndex = this.buffer.indexOf("\n");
      if (newlineIndex === -1) {
        break;
      }
      const line = this.buffer.slice(0, newlineIndex).trim();
      this.buffer = this.buffer.slice(newlineIndex + 1);
      if (!line) {
        continue;
      }
      try {
        const message = parseJsonLine(line);
        if (message) {
          this.processPaseoMessage(message, handlers);
        }
      } catch (error) {
        this.errors.push(error instanceof Error ? error : new Error(String(error)));
      }
    }
  }

  private processPaseoMessage(message: JsonRecord, handlers: Record<string, RequestHandler>): void {
    this.messages.push(message);
    for (const waiter of Array.from(this.waiters)) {
      if (waiter.predicate(message)) {
        this.waiters.delete(waiter);
        waiter.resolve(message);
      }
    }

    if (typeof message.id !== "number" || typeof message.method !== "string") {
      return;
    }

    const handler = handlers[message.method];
    if (!handler) {
      this.errors.push(new Error(`Unexpected Codex app-server request: ${message.method}`));
      return;
    }

    Promise.resolve(handler(message.params))
      .then((result) => {
        this.writeResponse(message.id as number, result);
        return undefined;
      })
      .catch((error) => {
        this.child.stdout.write(
          `${JSON.stringify({
            id: message.id,
            error: { message: error instanceof Error ? error.message : String(error) },
          })}\n`,
        );
        return undefined;
      });
  }

  private waitForMessage(
    predicate: (message: JsonRecord) => boolean,
    label: string,
  ): Promise<JsonRecord> {
    const existing = this.messages.find(predicate);
    if (existing) {
      return Promise.resolve(existing);
    }
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.waiters.delete(waiter);
        reject(new Error(`Timed out waiting for ${label}`));
      }, 1000);
      const waiter = {
        predicate,
        resolve: (message: JsonRecord) => {
          clearTimeout(timeout);
          resolve(message);
        },
      };
      this.waiters.add(waiter);
    });
  }
}
