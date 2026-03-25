import { z } from "zod";

import type { PersistedProjectKind, PersistedWorkspaceKind } from "./workspace-registry-model.js";

const PersistedProjectRecordSchema = z.object({
  projectId: z.string(),
  rootPath: z.string(),
  kind: z.enum(["git", "non_git"]),
  displayName: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  archivedAt: z.string().nullable(),
});

const PersistedWorkspaceRecordSchema = z.object({
  workspaceId: z.string(),
  projectId: z.string(),
  cwd: z.string(),
  kind: z.enum(["local_checkout", "worktree", "directory"]),
  displayName: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  archivedAt: z.string().nullable(),
});

export type PersistedProjectRecord = z.infer<typeof PersistedProjectRecordSchema>;
export type PersistedWorkspaceRecord = z.infer<typeof PersistedWorkspaceRecordSchema>;

export function parsePersistedProjectRecords(input: unknown): PersistedProjectRecord[] {
  return z.array(PersistedProjectRecordSchema).parse(input);
}

export function parsePersistedWorkspaceRecords(input: unknown): PersistedWorkspaceRecord[] {
  return z.array(PersistedWorkspaceRecordSchema).parse(input);
}

export interface ProjectRegistry {
  initialize(): Promise<void>;
  existsOnDisk(): Promise<boolean>;
  list(): Promise<PersistedProjectRecord[]>;
  get(projectId: string): Promise<PersistedProjectRecord | null>;
  upsert(record: PersistedProjectRecord): Promise<void>;
  archive(projectId: string, archivedAt: string): Promise<void>;
  remove(projectId: string): Promise<void>;
}

export interface WorkspaceRegistry {
  initialize(): Promise<void>;
  existsOnDisk(): Promise<boolean>;
  list(): Promise<PersistedWorkspaceRecord[]>;
  get(workspaceId: string): Promise<PersistedWorkspaceRecord | null>;
  upsert(record: PersistedWorkspaceRecord): Promise<void>;
  archive(workspaceId: string, archivedAt: string): Promise<void>;
  remove(workspaceId: string): Promise<void>;
}

export function createPersistedProjectRecord(input: {
  projectId: string;
  rootPath: string;
  kind: PersistedProjectKind;
  displayName: string;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string | null;
}): PersistedProjectRecord {
  return PersistedProjectRecordSchema.parse({
    ...input,
    archivedAt: input.archivedAt ?? null,
  });
}

export function createPersistedWorkspaceRecord(input: {
  workspaceId: string;
  projectId: string;
  cwd: string;
  kind: PersistedWorkspaceKind;
  displayName: string;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string | null;
}): PersistedWorkspaceRecord {
  return PersistedWorkspaceRecordSchema.parse({
    ...input,
    archivedAt: input.archivedAt ?? null,
  });
}
