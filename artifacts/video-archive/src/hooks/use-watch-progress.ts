import { useEffect, useRef, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { userApi, recordingToMeta } from "@/lib/user-api";
import type { Recording } from "@/lib/api";

interface WatchProgressOptions {
  video: Recording | null | undefined;
  /** Estimated duration in seconds (from metadata). If null, uses a default. */
  durationSeconds?: number | null;
  /** True only after the user starts an in-page player. */
  isActive: boolean;
}

/**
 * Tracks estimated watch time only while an in-page player has been started
 * and the document is visible. Cross-origin embeds do not expose play/pause or
 * seek events, so this is an active-session estimate, not exact media position.
 */
export function useWatchProgress({ video, durationSeconds, isActive }: WatchProgressOptions) {
  const { user } = useAuth();
  const totalMsRef = useRef(0);
  const lastActiveAtRef = useRef<number | null>(null);
  const unmountedRef = useRef(false);
  const estimatedDurationMs = (durationSeconds ?? 600) * 1000;

  useEffect(() => {
    totalMsRef.current = 0;
    lastActiveAtRef.current = null;
  }, [video?.id]);

  const syncProgress = useCallback(() => {
    if (!video?.id || !user) return;
    const now = Date.now();
    if (lastActiveAtRef.current !== null) {
      totalMsRef.current += Math.max(0, now - lastActiveAtRef.current);
      lastActiveAtRef.current = now;
    } else {
      lastActiveAtRef.current = null;
    }
    // Do not create empty history entries if the player was never started.
    if (totalMsRef.current <= 0) return;

    const progress = Math.min(100, Math.round((totalMsRef.current / estimatedDurationMs) * 100));
    const lastPositionMs = totalMsRef.current;
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
        userApi.addHistory(video.id, recordingToMeta(meta)).catch(() => {});
      });
  }, [video, user, estimatedDurationMs]);

  useEffect(() => {
    if (!video?.id || !user || !isActive) {
      lastActiveAtRef.current = null;
      return;
    }

    unmountedRef.current = false;
    lastActiveAtRef.current = document.hidden ? null : Date.now();
    const interval = window.setInterval(() => {
      if (!document.hidden) syncProgress();
    }, 15_000);

    const onVisibility = () => {
      if (document.hidden) {
        syncProgress();
        lastActiveAtRef.current = null;
      } else if (!unmountedRef.current) {
        lastActiveAtRef.current = Date.now();
      }
    };
    const onBeforeUnload = () => {
      if (!unmountedRef.current) syncProgress();
    };

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      unmountedRef.current = true;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("beforeunload", onBeforeUnload);
      syncProgress();
      lastActiveAtRef.current = null;
    };
  }, [video?.id, user, isActive, syncProgress]);
}
