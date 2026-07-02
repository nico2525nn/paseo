import type { Command } from "commander";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";

import { connectToDaemon } from "../../utils/client.js";
import type {
  CommandError,
  CommandOptions,
  OutputSchema,
  SingleResult,
} from "../../output/index.js";

interface ProviderRmOptions extends CommandOptions {
  host?: string;
}

interface ProviderRemoveItem {
  name: string;
  removed: string;
}

interface ProviderRmClient extends Pick<
  DaemonClient,
  "getLastServerInfoMessage" | "removePaseoAgentProvider" | "close"
> {}

export interface ProviderRmDependencies {
  connectDaemon: (options: { host?: string }) => Promise<ProviderRmClient>;
}

const defaultDependencies: ProviderRmDependencies = {
  connectDaemon: connectToDaemon,
};

export const providerRemoveSchema: OutputSchema<ProviderRemoveItem> = {
  idField: "name",
  columns: [
    { header: "NAME", field: "name", width: 20 },
    { header: "REMOVED", field: "removed", width: 10 },
  ],
};

function requirePaseoAgentCatalogFeature(
  client: Pick<DaemonClient, "getLastServerInfoMessage">,
): void {
  if (client.getLastServerInfoMessage()?.features?.paseoAgentCatalog === true) {
    return;
  }
  throw {
    code: "HOST_UPDATE_REQUIRED",
    message: "Update the Paseo daemon to use this command.",
  } satisfies CommandError;
}

export async function runRmCommand(
  name: string,
  options: ProviderRmOptions,
  _command: Command,
  dependencies: Partial<ProviderRmDependencies> = {},
): Promise<SingleResult<ProviderRemoveItem>> {
  const deps = { ...defaultDependencies, ...dependencies };
  const client = await deps.connectDaemon({ host: options.host });
  try {
    requirePaseoAgentCatalogFeature(client);
    const result = await client.removePaseoAgentProvider(name);
    if (!result.success) {
      throw {
        code: "PROVIDER_REMOVE_FAILED",
        message: result.error ?? "Daemon rejected the provider removal request.",
      } satisfies CommandError;
    }
    return {
      type: "single",
      data: {
        name,
        removed: result.removed ? "yes" : "no",
      },
      schema: providerRemoveSchema,
    };
  } finally {
    await client.close().catch(() => {});
  }
}
