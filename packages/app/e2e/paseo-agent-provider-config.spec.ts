import { test } from "./fixtures";
import {
  addApiKeyProvider,
  cleanupPaseoAgentProviders,
  expectModelProviderListed,
  openPaseoAgentSettings,
  seedChatGptProvider,
  startOAuthProviderSignIn,
} from "./helpers/paseo-agent";

const OPENROUTER_PROVIDER = "phase-e-openrouter-ui";
const CHATGPT_PROVIDER = "phase-e-chatgpt-ui";

test.describe("Paseo Agent provider configuration", () => {
  const providerNamesToCleanup = new Set<string>();

  test.afterEach(async () => {
    await cleanupPaseoAgentProviders(providerNamesToCleanup);
    providerNamesToCleanup.clear();
  });

  test("adds an OpenRouter model provider from Settings", async ({ page }) => {
    providerNamesToCleanup.add(OPENROUTER_PROVIDER);

    await openPaseoAgentSettings(page);
    await addApiKeyProvider(page, {
      catalogId: "openrouter",
      name: OPENROUTER_PROVIDER,
      apiKey: "sk-or-phase-e-write-only",
      models: ["openai/gpt-4o-mini", "anthropic/claude-3.7-sonnet"],
    });

    await expectModelProviderListed(page, {
      name: OPENROUTER_PROVIDER,
      providerLabel: "OpenRouter",
      modelCount: 2,
      auth: "Connected",
    });
  });

  test("starts a ChatGPT sign-in from Settings", async ({ page }) => {
    providerNamesToCleanup.add(CHATGPT_PROVIDER);

    await openPaseoAgentSettings(page);
    await startOAuthProviderSignIn(page, {
      catalogId: "chatgpt",
      name: CHATGPT_PROVIDER,
    });
  });

  test("shows a stored ChatGPT login as a read-only model provider row", async ({ page }) => {
    providerNamesToCleanup.add(CHATGPT_PROVIDER);

    await seedChatGptProvider(CHATGPT_PROVIDER);
    await openPaseoAgentSettings(page);

    await expectModelProviderListed(page, {
      name: CHATGPT_PROVIDER,
      providerLabel: "ChatGPT",
      modelCount: 1,
      auth: "Connected",
    });
  });
});
