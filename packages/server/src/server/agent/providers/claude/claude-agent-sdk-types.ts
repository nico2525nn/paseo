import type { ChildProcess } from "node:child_process";

export type PermissionMode = "default" | "acceptEdits" | "plan" | "bypassPermissions" | "auto";

export interface PermissionUpdate extends Record<string, unknown> {
  type: "addRules" | "replaceRules" | "removeRules";
  rules: string[];
  behavior: string;
  destination: string;
}

export type PermissionResult =
  | {
      behavior: "allow";
      updatedInput?: Record<string, unknown>;
      updatedPermissions?: PermissionUpdate[];
    }
  | {
      behavior: "deny";
      message?: string;
      interrupt?: boolean;
      updatedPermissions?: PermissionUpdate[];
    };

export type CanUseTool = (
  toolName: string,
  input: Record<string, unknown>,
  options: {
    signal: AbortSignal;
    suggestions?: PermissionUpdate[];
    blockedPath?: string;
    decisionReason?: string;
    title?: string;
    displayName?: string;
    description?: string;
    toolUseID: string;
    agentID?: string;
  },
) => Promise<PermissionResult>;

export interface AgentDefinition {
  description: string;
  prompt: string;
  tools?: string[];
  disallowedTools?: string[];
  model?: string;
  mcpServers?: unknown[];
  criticalSystemReminder_EXPERIMENTAL?: string;
  skills?: string[];
  initialPrompt?: string;
  maxTurns?: number;
  background?: boolean;
  memory?: "user" | "project" | "local";
  effort?: "low" | "medium" | "high" | "xhigh" | "max" | number;
  permissionMode?: PermissionMode;
}

export type McpServerConfig =
  | {
      type: "stdio";
      command: string;
      args?: string[];
      env?: Record<string, string>;
      alwaysLoad?: boolean;
    }
  | { type: "http"; url: string; headers?: Record<string, string>; alwaysLoad?: boolean }
  | { type: "sse"; url: string; headers?: Record<string, string>; alwaysLoad?: boolean };

export interface SpawnOptions {
  command: string;
  args: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
}

export interface Options {
  abortController?: AbortController;
  additionalDirectories?: string[];
  agent?: string;
  agents?: Record<string, AgentDefinition>;
  allowedTools?: string[];
  allowDangerouslySkipPermissions?: boolean;
  canUseTool?: CanUseTool;
  continue?: boolean;
  cwd?: string;
  disallowedTools?: string[];
  enableFileCheckpointing?: boolean;
  env?: NodeJS.ProcessEnv;
  effort?: "low" | "medium" | "high" | "xhigh" | "max" | number;
  includePartialMessages?: boolean;
  maxThinkingTokens?: number;
  mcpServers?: Record<string, McpServerConfig>;
  model?: string;
  pathToClaudeCodeExecutable?: string;
  permissionMode?: PermissionMode;
  persistSession?: boolean;
  resume?: string;
  sessionId?: string;
  settingSources?: Array<"user" | "project" | "local" | "managed">;
  settings?: string | Record<string, unknown>;
  spawnClaudeCodeProcess?: (spawnOptions: SpawnOptions) => ChildProcess;
  stderr?: (data: string) => void;
  systemPrompt?:
    | string
    | { type: "preset"; preset: string; append?: string }
    | Record<string, unknown>;
  thinking?: { type: "adaptive" } | { type: "enabled"; budgetTokens?: number };
  tools?: string[] | { type: "preset"; preset: string };
}

export interface SDKBaseMessage {
  type: string;
  subtype?: string;
  uuid?: string;
  session_id?: string;
  parent_tool_use_id?: string | null;
  [key: string]: unknown;
}

export interface SDKUserMessage extends SDKBaseMessage {
  type: "user";
  message: { role?: "user"; content: string | ReadonlyArray<unknown> };
}

export interface SDKAssistantMessage extends SDKBaseMessage {
  type: "assistant";
  message: { content: ReadonlyArray<unknown> };
}

export interface SDKPartialAssistantMessage extends SDKBaseMessage {
  type: "stream_event";
  event:
    | {
        type: "content_block_start";
        index: number;
        content_block?: unknown;
        [key: string]: unknown;
      }
    | {
        type: "content_block_delta";
        index: number;
        delta?: unknown;
        [key: string]: unknown;
      }
    | { type: "content_block_stop"; index: number; [key: string]: unknown }
    | { type: "message_start"; [key: string]: unknown }
    | { type: "message_delta"; [key: string]: unknown };
  modelUsage?: unknown;
}

export interface SDKInitSystemMessage extends SDKBaseMessage {
  type: "system";
  subtype: "init";
  permissionMode: PermissionMode;
  model?: string;
}

export interface SDKStatusSystemMessage extends SDKBaseMessage {
  type: "system";
  subtype: "status";
}

export interface SDKCompactBoundaryMessage extends SDKBaseMessage {
  type: "system";
  subtype: "compact_boundary";
}

export interface SDKTaskNotificationMessage extends SDKBaseMessage {
  type: "system";
  subtype: "task_notification";
  tool_use_id?: string;
  usage?: unknown;
}

export interface SDKTaskProgressMessage extends SDKBaseMessage {
  type: "system";
  subtype: "task_progress";
  usage?: unknown;
}

export type SDKSystemMessage =
  | SDKInitSystemMessage
  | SDKStatusSystemMessage
  | SDKCompactBoundaryMessage
  | SDKTaskNotificationMessage
  | SDKTaskProgressMessage;

export interface SDKResultMessage extends SDKBaseMessage {
  type: "result";
  subtype: "success" | "error_during_execution" | string;
  result?: string;
  errors?: string[];
  modelUsage?: unknown;
  total_cost_usd?: number;
  usage?: {
    input_tokens?: number;
    cache_read_input_tokens?: number;
    output_tokens?: number;
  };
}

export type SDKMessage =
  | SDKUserMessage
  | SDKAssistantMessage
  | SDKPartialAssistantMessage
  | SDKSystemMessage
  | SDKTaskProgressMessage
  | SDKResultMessage
  | (SDKBaseMessage & { type: "tool_progress"; tool_name?: string; tool_use_id?: string });

export interface Query extends AsyncGenerator<SDKMessage, void> {
  interrupt(): Promise<void>;
  setPermissionMode(mode: PermissionMode): Promise<void>;
  setModel(model?: string): Promise<void>;
  applyFlagSettings(settings: Record<string, unknown>): Promise<void>;
  supportedCommands(): Promise<Array<{ name: string; description: string; argumentHint: string }>>;
  rewindFiles(
    messageId: string,
    options: { dryRun: boolean },
  ): Promise<{ canRewind: boolean; error?: string }>;
  close(): void;
}

export declare function query(params: {
  prompt: string | AsyncIterable<SDKUserMessage>;
  options?: Options;
}): Query;

export declare function forkSession(
  sessionId: string,
  options: { upToMessageId: string },
): Promise<{ sessionId: string }>;

export declare function getSessionInfo(...args: unknown[]): Promise<unknown>;
