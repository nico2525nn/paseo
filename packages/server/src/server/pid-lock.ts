import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { open, readFile, unlink, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { hostname } from "node:os";
import { z } from "zod";

export const pidLockInfoSchema = z.object({
  pid: z.number(),
  startedAt: z.string(),
  hostname: z.string(),
  uid: z.number(),
  listen: z.string().nullable(),
  desktopManaged: z.boolean().optional(),
});

export interface PidLockInfo extends z.infer<typeof pidLockInfoSchema> {}

function parsePidLockInfo(raw: unknown): PidLockInfo | null {
  const result = pidLockInfoSchema.safeParse(raw);
  return result.success ? result.data : null;
}

function isErrnoException(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && "code" in err;
}

export class PidLockError extends Error {
  constructor(
    message: string,
    public readonly existingLock?: PidLockInfo,
  ) {
    super(message);
    this.name = "PidLockError";
  }
}

const PROCESS_START_SKEW_TOLERANCE_MS = 60_000;
const PROCESS_LOCK_ACQUIRE_TOLERANCE_MS = 5 * 60_000;
const POSIX_PROCESS_TIME_ENV = { ...process.env, LC_ALL: "C", LANG: "C" };
let cachedClockTicksPerSecond: number | null = null;

function isPidRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readClockTicksPerSecond(): number {
  if (cachedClockTicksPerSecond !== null) {
    return cachedClockTicksPerSecond;
  }

  try {
    const output = execFileSync("getconf", ["CLK_TCK"], {
      encoding: "utf8",
      timeout: 1000,
    }).trim();
    const value = Number(output);
    cachedClockTicksPerSecond = Number.isFinite(value) && value > 0 ? value : 100;
  } catch {
    cachedClockTicksPerSecond = 100;
  }

  return cachedClockTicksPerSecond;
}

function readLinuxProcessStartedAtMs(pid: number): number | null {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    const closeParen = stat.lastIndexOf(")");
    if (closeParen === -1) return null;

    const fieldsAfterCommand = stat
      .slice(closeParen + 2)
      .trim()
      .split(/\s+/);
    const startTicks = Number(fieldsAfterCommand[19]);
    if (!Number.isFinite(startTicks)) return null;

    const bootTimeLine = readFileSync("/proc/stat", "utf8")
      .split("\n")
      .find((line) => line.startsWith("btime "));
    const bootSeconds = Number(bootTimeLine?.trim().split(/\s+/)[1]);
    if (!Number.isFinite(bootSeconds)) return null;

    return bootSeconds * 1000 + (startTicks / readClockTicksPerSecond()) * 1000;
  } catch {
    return null;
  }
}

function readPsProcessStartedAtMs(pid: number): number | null {
  try {
    const output = execFileSync("ps", ["-p", String(pid), "-o", "lstart="], {
      encoding: "utf8",
      env: POSIX_PROCESS_TIME_ENV,
      timeout: 1000,
    }).trim();
    const parsed = Date.parse(output);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function readWindowsProcessStartedAtMs(pid: number): number | null {
  try {
    const command = [
      `$p = Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}"`,
      'if ($p) { $p.CreationDate.ToUniversalTime().ToString("o") }',
    ].join("; ");
    const output = execFileSync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", command],
      {
        encoding: "utf8",
        timeout: 3000,
      },
    ).trim();
    const parsed = Date.parse(output);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function readProcessStartedAtMs(pid: number): number | null {
  if (process.platform === "linux") {
    return readLinuxProcessStartedAtMs(pid) ?? readPsProcessStartedAtMs(pid);
  }
  if (process.platform === "win32") {
    return readWindowsProcessStartedAtMs(pid);
  }
  return readPsProcessStartedAtMs(pid);
}

function lockMatchesLiveProcessIdentity(lock: PidLockInfo): boolean {
  const lockStartedAtMs = Date.parse(lock.startedAt);
  if (!Number.isFinite(lockStartedAtMs)) {
    return false;
  }

  const processStartedAtMs = readProcessStartedAtMs(lock.pid);
  if (processStartedAtMs === null) {
    return true;
  }

  if (processStartedAtMs - lockStartedAtMs > PROCESS_START_SKEW_TOLERANCE_MS) {
    return false;
  }
  if (lockStartedAtMs - processStartedAtMs > PROCESS_LOCK_ACQUIRE_TOLERANCE_MS) {
    return false;
  }

  return true;
}

function isPidLockOwnerRunning(lock: PidLockInfo): boolean {
  if (!isPidRunning(lock.pid)) {
    return false;
  }

  // PIDs can be reused after an unclean daemon exit. Treat a live PID as the
  // lock owner only when its process start time still lines up with the lock.
  return lockMatchesLiveProcessIdentity(lock);
}

function getPidFilePath(paseoHome: string): string {
  return join(paseoHome, "paseo.pid");
}

function resolveOwnerPid(ownerPid?: number): number {
  if (typeof ownerPid === "number" && Number.isInteger(ownerPid) && ownerPid > 0) {
    return ownerPid;
  }
  return process.pid;
}

export async function acquirePidLock(
  paseoHome: string,
  listen: string | null,
  options?: { ownerPid?: number },
): Promise<void> {
  const pidPath = getPidFilePath(paseoHome);

  // Ensure paseoHome directory exists
  if (!existsSync(paseoHome)) {
    await mkdir(paseoHome, { recursive: true });
  }

  // Try to read existing lock
  let existingLock: PidLockInfo | null = null;
  try {
    const content = await readFile(pidPath, "utf-8");
    existingLock = parsePidLockInfo(JSON.parse(content));
  } catch {
    // No existing lock or invalid JSON - that's fine
  }

  // Check if existing lock is stale
  const lockOwnerPid = resolveOwnerPid(options?.ownerPid);
  if (existingLock) {
    if (isPidLockOwnerRunning(existingLock)) {
      if (existingLock.pid === lockOwnerPid) {
        return;
      }

      throw new PidLockError(
        `Another Paseo daemon is already running (PID ${existingLock.pid}, started ${existingLock.startedAt})`,
        existingLock,
      );
    }
    // Stale lock - remove it
    await unlink(pidPath).catch(() => {});
  }

  // Create new lock with exclusive flag
  const lockInfo: PidLockInfo = {
    pid: lockOwnerPid,
    startedAt: new Date().toISOString(),
    hostname: hostname(),
    uid: process.getuid?.() ?? 0,
    listen,
    ...(process.env.PASEO_DESKTOP_MANAGED === "1" ? { desktopManaged: true } : {}),
  };

  let fd;
  try {
    fd = await open(pidPath, "wx");
    await fd.write(JSON.stringify(lockInfo));
  } catch (err) {
    if (isErrnoException(err) && err.code === "EEXIST") {
      // Race condition - another process created the file
      // Re-read and check
      try {
        const content = await readFile(pidPath, "utf-8");
        const raceLock = parsePidLockInfo(JSON.parse(content));
        if (raceLock) {
          throw new PidLockError(
            `Another Paseo daemon is already running (PID ${raceLock.pid})`,
            raceLock,
          );
        }
        throw new PidLockError("Failed to acquire PID lock due to race condition");
      } catch (innerErr) {
        if (innerErr instanceof PidLockError) throw innerErr;
        throw new PidLockError("Failed to acquire PID lock due to race condition");
      }
    }
    throw err;
  } finally {
    await fd?.close();
  }
}

export async function updatePidLock(
  paseoHome: string,
  patch: { listen: string },
  options?: { ownerPid?: number },
): Promise<void> {
  const pidPath = getPidFilePath(paseoHome);
  const lockOwnerPid = resolveOwnerPid(options?.ownerPid);
  const content = await readFile(pidPath, "utf-8");
  const existingLock = parsePidLockInfo(JSON.parse(content));
  if (!existingLock) {
    throw new PidLockError("Cannot update PID lock: invalid lock file");
  }

  if (existingLock.pid !== lockOwnerPid) {
    throw new PidLockError(`Cannot update PID lock owned by PID ${existingLock.pid}`, existingLock);
  }

  const updatedLock: PidLockInfo = {
    ...existingLock,
    ...patch,
  };

  const fd = await open(pidPath, "r+");
  try {
    await fd.truncate(0);
    await fd.writeFile(JSON.stringify(updatedLock));
  } finally {
    await fd.close();
  }
}

export async function releasePidLock(
  paseoHome: string,
  options?: { ownerPid?: number },
): Promise<void> {
  const pidPath = getPidFilePath(paseoHome);
  const lockOwnerPid = resolveOwnerPid(options?.ownerPid);
  try {
    // Only remove if it's our lock
    const content = await readFile(pidPath, "utf-8");
    const lock = parsePidLockInfo(JSON.parse(content));
    if (lock?.pid === lockOwnerPid) {
      await unlink(pidPath);
    }
  } catch {
    // Ignore errors - lock may already be gone
  }
}

export async function getPidLockInfo(paseoHome: string): Promise<PidLockInfo | null> {
  const pidPath = getPidFilePath(paseoHome);
  try {
    const content = await readFile(pidPath, "utf-8");
    return parsePidLockInfo(JSON.parse(content));
  } catch {
    return null;
  }
}

export async function isLocked(
  paseoHome: string,
): Promise<{ locked: boolean; info?: PidLockInfo }> {
  const info = await getPidLockInfo(paseoHome);
  if (!info) {
    return { locked: false };
  }
  if (!isPidLockOwnerRunning(info)) {
    return { locked: false, info };
  }
  return { locked: true, info };
}
