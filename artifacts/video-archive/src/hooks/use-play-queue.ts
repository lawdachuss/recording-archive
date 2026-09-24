import { useState, useEffect } from "react";
import { getQueue, subscribeQueue, type PlayQueue } from "@/lib/play-queue";

/**
 * Reactive view of the playback queue (see lib/play-queue.ts).
 * Re-reads storage whenever a queue mutation is dispatched, so every
 * consumer (QueueBar, VideoDetail) stays in sync from one source of truth.
 */
export function usePlayQueue(): PlayQueue | null {
  const [queue, setQueueState] = useState<PlayQueue | null>(() => getQueue());

  useEffect(() => subscribeQueue(() => setQueueState(getQueue())), []);

  return queue;
}
