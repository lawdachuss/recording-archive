import { useEffect, useRef } from "react";

/**
 * Generates a short two-tone notification chime using the Web Audio API.
 * No audio files needed — the sound is synthesized on the fly.
 */
function playNotificationSound() {
  try {
    const ctx = new AudioContext();
    const gain = ctx.createGain();
    gain.connect(ctx.destination);
    gain.gain.setValueAtTime(0.08, ctx.currentTime); // Quiet & subtle
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);

    // First tone — higher pitch "ding"
    const osc1 = ctx.createOscillator();
    osc1.type = "sine";
    osc1.frequency.setValueAtTime(880, ctx.currentTime); // A5
    osc1.connect(gain);
    osc1.start(ctx.currentTime);
    osc1.stop(ctx.currentTime + 0.15);

    // Second tone — slightly lower "dong" (overlaps briefly)
    const osc2 = ctx.createOscillator();
    osc2.type = "sine";
    osc2.frequency.setValueAtTime(660, ctx.currentTime + 0.12); // E5, delayed
    osc2.connect(gain);
    osc2.start(ctx.currentTime + 0.12);
    osc2.stop(ctx.currentTime + 0.35);

    // Clean up the context after the sound finishes
    setTimeout(() => ctx.close(), 500);
  } catch {
    // Web Audio API not available — silently skip
  }
}

/**
 * Triggers a short vibration on devices that support the Vibration API.
 */
function vibrate() {
  try {
    if ("vibrate" in navigator) {
      navigator.vibrate(50); // 50ms short pulse
    }
  } catch {
    // Vibration API not available — silently skip
  }
}

/**
 * Plays a notification sound and vibrates when the unread notification
 * count increases (i.e., a new notification arrives while the page is open).
 *
 * Optionally pass `onNewNotification` to show a toast or other UI feedback.
 * The callback receives the newest unread notification.
 *
 * Pass `soundEnabled` and `vibrationEnabled` to independently control
 * whether the sound and/or vibration fire (both default true).
 *
 * Pass the list of notifications — the hook internally tracks the previous
 * unread count and fires on increases.
 */
export function useNotificationSound(
  notifications: { id?: number; is_read: boolean; message?: string; type?: string }[],
  enabled = true,
  onNewNotification?: (notification: { id?: number; message?: string; type?: string }) => void,
  opts?: { sound?: boolean; vibration?: boolean },
) {
  const prevUnreadRef = useRef(-1);

  useEffect(() => {
    if (!enabled) return;

    const unread = notifications.filter((n) => !n.is_read).length;
    const prev = prevUnreadRef.current;
    prevUnreadRef.current = unread;

    // Only fire when the count *increases* (new notification arrived).
    // prev === -1 on first mount so we skip the initial render.
    if (unread > prev && prev !== -1) {
      const soundOn = opts?.sound !== false;
      const vibrateOn = opts?.vibration !== false;

      if (soundOn) playNotificationSound();
      if (vibrateOn) vibrate();

      // Find the newest unread notification (highest id or latest created_at)
      // and pass it to the callback so the consumer can show a toast etc.
      if (onNewNotification) {
        const newest = notifications
          .filter((n) => !n.is_read)
          .sort((a, b) => (b.id ?? 0) - (a.id ?? 0))[0];
        if (newest) {
          onNewNotification({
            id: newest.id,
            message: newest.message,
            type: newest.type,
          });
        }
      }
    }
  }, [notifications, enabled, onNewNotification, opts?.sound, opts?.vibration]);
}
