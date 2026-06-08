import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type {
  CallToolResult,
  ServerNotification,
  ServerRequest,
} from "@modelcontextprotocol/sdk/types.js";

export interface ToolConfig {
  title?: string;
  description?: string;
  inputSchema?: unknown;
  outputSchema?: unknown;
  annotations?: unknown;
  [key: string]: unknown;
}

// oxlint-disable-next-line typescript-eslint/no-explicit-any -- mirrors MCP's schema-inferred handler args without importing its zod-heavy generics.
type ToolArgs = any;

export type ToolHandler = (
  args: ToolArgs,
  extra: RequestHandlerExtra<ServerRequest, ServerNotification>,
) => CallToolResult | Promise<CallToolResult>;

export interface RegisteredTool {
  remove?: () => void;
}

export declare class McpServer {
  constructor(config: { name: string; version: string });
  registerTool(name: string, config: ToolConfig, handler: ToolHandler): RegisteredTool;
  connect(transport: unknown): Promise<void>;
}
