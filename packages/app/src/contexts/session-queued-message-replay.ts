import type { AttachmentMetadata } from "@/attachments/types";

export interface QueuedAgentMessageReplayItem {
  id: string;
  text: string;
  images?: AttachmentMetadata[];
}

export interface QueuedAgentMessageReplay {
  messageId: string;
  text: string;
  images?: AttachmentMetadata[];
  remainingQueue: QueuedAgentMessageReplayItem[];
}

export function takeQueuedAgentMessageReplay(
  queue: readonly QueuedAgentMessageReplayItem[] | undefined,
): QueuedAgentMessageReplay | null {
  if (!queue || queue.length === 0) {
    return null;
  }

  const [next, ...remainingQueue] = queue;
  return {
    messageId: next.id,
    text: next.text,
    images: next.images,
    remainingQueue,
  };
}
