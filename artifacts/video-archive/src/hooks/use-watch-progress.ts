import { useEffect, useRef, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { userApi, recordingToMeta } from "@/lib/user-api";
import type { Recording } from "@/lib/api";

interface WatchProgressOptions {
  video: Recording | null | undefined;
  /** Estimated duration in seconds (from metadata). If null, uses a default. */
  durationSeconds?: number | null;
}

/**
 * Tracks watch progress for a video based on time spent on the page.
 *
 * Strategy:
 * - Records time spent watching (incremented every 5s while tab is visible)
 * - Estimates progress as min(100, (timeSpent / estimatedDuration) * 100)
 * - Syncs to server every 15 seconds and on unmount
 * - Saves resume position (last known time spent)
 */
export function useWatchProgress({ video, durationSeconds }: WatchProgressOptions) {
  const { user } = useAuth();
  const startTimeRef = useRef(Date.now());
  const totalMsRef = useRef(0);
  const lastSyncRef = useRef(0);
  const syncIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const unmountedRef = useRef(false);

  // Estimate duration: use provided, fallback to 10 minutes (600s)
  const estimatedDurationMs = (durationSeconds ?? 600) * 1000;

  const syncProgress = useCallback(() => {
    if (!video?.id || !user) return;

    const now = Date.now();
    const elapsed = now - startTimeRef.current;
    totalMsRef.current += elapsed;
    startTimeRef.current = now;

    const progress = Math.min(100, Math.round((totalMsRef.current / estimatedDurationMs) * 100));
    const lastPositionMs = totalMsRef.current;

    // Build metadata
    const meta = {
      id: video.id,
      username: video.username,
      filename: video.filename,
      room_title: video.room_title,
      thumbnail_url: video.thumbnail_url,
      preview_url: video.preview_url,
      sprite_url: video.sprite_url,
      resolution: video.resolution,
      timestamp: video.timestamp,
      saved_at: new Date().toISOString(),
    };

    userApi
      .updateHistoryProgress(video.id, progress, lastPositionMs, totalMsRef.current)
      .catch(() => {
        // Also ensure history entry exists with metadata
        userApi.addHistory(video.id, recordingToMeta(meta)).catch(() => {});
      });

    lastSyncRef.current = now;
  }, [video, user, estimatedDurationMs]);

  useEffect(() => {
    if (!video?.id) return;

    startTimeRef.current = Date.now();
    totalMsRef.current = 0;
    lastSyncRef.current = 0;
    unmountedRef.current = false;

    // Sync every 15 seconds while tab is visible
    syncIntervalRef.current = setInterval(() => {
      if (!document.hidden) {
        syncProgress();
      }
    }, 15_000);

    // Handle tab visibility changes — sync when tab becomes hidden
    const onVisibility = () => {
      if (document.hidden && !unmountedRef.current) {
        syncProgress();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    // Sync on page unload
    const onBeforeUnload = () => {
      if (!unmountedRef.current) {
        syncProgress();
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);

    return () => {
      unmountedRef.current = true;
      if (syncIntervalRef.current) clearInterval(syncIntervalRef.current);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("beforeunload", onBeforeUnload);
      // Final sync on unmount
      syncProgress();
    };
  }, [video?.id, syncProgress]);
}
