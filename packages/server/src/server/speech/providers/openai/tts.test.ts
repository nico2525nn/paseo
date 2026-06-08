import type pino from "pino";
import { ReadableStream } from "node:stream/web";
import { beforeEach, describe, expect, test, vi } from "vitest";

const openAiMocks = vi.hoisted(() => ({
  createSpeech: vi.fn(),
}));

vi.mock("openai", () => ({
  OpenAI: vi.fn().mockImplementation(
    class {
      audio = {
        speech: {
          create: openAiMocks.createSpeech,
        },
      };
    },
  ),
}));

import { OpenAITTS } from "./tts.js";

function createLogger(): pino.Logger {
  const logger = {
    child: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  };

  logger.child.mockReturnValue(logger);

  return logger as unknown as pino.Logger;
}

describe("OpenAITTS", () => {
  beforeEach(() => {
    openAiMocks.createSpeech.mockReset();
  });

  test("returns a Node stream from the OpenAI web response body", async () => {
    openAiMocks.createSpeech.mockResolvedValue({
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(Buffer.from("audio"));
          controller.close();
        },
      }),
    });

    const tts = new OpenAITTS({ apiKey: "sk-test" }, createLogger());
    const result = await tts.synthesizeSpeech("hello");

    const chunks: Buffer[] = [];
    for await (const chunk of result.stream) {
      chunks.push(Buffer.from(chunk));
    }

    expect(Buffer.concat(chunks).toString()).toBe("audio");
    expect(result.format).toBe("pcm");
  });
});
