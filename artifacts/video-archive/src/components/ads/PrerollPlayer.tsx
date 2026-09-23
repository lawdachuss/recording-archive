import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronRight, VolumeX } from "lucide-react";
import {
  PREROLL_SKIP_AFTER_MS,
  PREROLL_START_TIMEOUT_MS,
  type PrerollCreative,
} from "@/lib/preroll";

/**
 * PrerollPlayer — the pre-roll overlay that gates VideoDetail playback.
 *
 * Renders over (or instead of) the player box until the ad ends, errors out
 * or is skipped, then `onDone` starts the main video. Rules:
 *
 *   - NEVER blocks content: a video `error`, a start that hangs past
 *     PREROLL_START_TIMEOUT_MS, or the Skip button (after 5s) release
 *     immediately — a dead ad URL costs an impression, never the video;
 *   - sound follows the browser autoplay policy: when the play action was a
 *     real click (the poster's "Click to play" → `withGesture`), full volume
 *     is tried first and falls back to muted; autoplay without a gesture
 *     starts muted and shows an Unmute pill;
 *   - html creatives (pasted iframe embeds) get the same chrome; they cannot
 *     report "ended" cross-origin, so the Skip button is their way out.
 */
export interface PrerollPlayerProps {
  creative: PrerollCreative;
  /** Ad finished, failed or was skipped → start the main video. Called at most once. */
  onDone: () => void;
  /** True when a user click just happened (soundful autoplay is allowed). */
  withGesture?: boolean;
}

export function PrerollPlayer({ creative, onDone, withGesture = false }: PrerollPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const doneRef = useRef(false);
  const startedRef = useRef(false);
  const [muted, setMuted] = useState(false);
  const [skipIn, setSkipIn] = useState(Math.ceil(PREROLL_SKIP_AFTER_MS / 1000));

  const finish = useCallback(() => {
    if (doneRef.current) return;
    doneRef.current = true;
    onDone();
  }, [onDone]);

  // Skip countdown.
  useEffect(() => {
    if (skipIn <= 0) return;
    const t = window.setTimeout(() => setSkipIn((s) => s - 1), 1000);
    return () => window.clearTimeout(t);
  }, [skipIn]);

  // Start watchdog — a preroll that never begins must not hold the player.
  useEffect(() => {
    if (creative.type !== "video") return;
    const t = window.setTimeout(() => {
      if (!startedRef.current) finish();
    }, PREROLL_START_TIMEOUT_MS);
    return () => window.clearTimeout(t);
  }, [creative.type, finish]);

  // Start playback: with a gesture, try full volume first (fall back to
  // muted on refusal); without one, guarantee a muted start so the ad — and
  // the impression — still happens under the autoplay policy.
  useEffect(() => {
    if (creative.type !== "video") return;
    const v = videoRef.current;
    if (!v) return;
    const play = () => {
      const p = v.play();
      if (p) p.catch(() => {});
    };
    if (withGesture) {
      v.muted = false;
      setMuted(false);
      const p = v.play();
      if (p) {
        p.catch(() => {
          v.muted = true;
          setMuted(true);
          play();
        });
      }
    } else {
      v.muted = true;
      setMuted(true);
      play();
    }
  }, [creative.type, withGesture]);

  const toggleMute = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (!v.muted) {
      v.muted = true;
      setMuted(true);
      return;
    }
    v.muted = false;
    setMuted(false);
    const p = v.play();
    if (p) {
      p.catch(() => {
        v.muted = true;
        setMuted(true);
      });
    }
  }, []);

  return (
    <div
      data-testid="preroll-player"
      aria-label="Advertisement"
      className="absolute inset-0 z-30 overflow-hidden bg-black"
    >
      {creative.type === "video" ? (
        <video
          ref={videoRef}
          src={creative.url}
          className="w-full h-full object-contain"
          autoPlay
          playsInline
          preload="auto"
          onPlaying={() => {
            startedRef.current = true;
          }}
          onEnded={finish}
          onError={finish}
        />
      ) : (
        <div
          className="w-full h-full [&_iframe]:absolute [&_iframe]:inset-0 [&_iframe]:h-full [&_iframe]:w-full [&_video]:h-full [&_video]:w-full"
          dangerouslySetInnerHTML={{ __html: creative.html }}
        />
      )}

      {/* Ad badge */}
      <span className="pointer-events-none absolute left-2 top-2 rounded-sm bg-black/60 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-white/70 ring-1 ring-white/10">
        Ad
      </span>

      {/* Bottom-right: countdown → Skip */}
      <div className="absolute bottom-3 right-3 z-10">
        {skipIn <= 0 ? (
          <button
            onClick={finish}
            className="flex items-center gap-1 rounded-sm bg-white/90 px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-black transition-colors hover:bg-white"
          >
            Skip <ChevronRight className="w-3.5 h-3.5" />
          </button>
        ) : (
          <span className="rounded-sm bg-black/60 px-2 py-1.5 text-[11px] font-medium tabular-nums text-white/80 ring-1 ring-white/10">
            Skip in {skipIn}
          </span>
        )}
      </div>

      {/* Unmute pill (muted-autoplay fallback, video creatives only) */}
      {creative.type === "video" && muted && (
        <button
          onClick={toggleMute}
          className="absolute bottom-3 left-3 z-10 flex items-center gap-1.5 rounded-sm bg-black/60 px-2 py-1.5 text-[11px] font-medium text-white/85 ring-1 ring-white/10 transition-colors hover:bg-black/80"
        >
          <VolumeX className="w-3.5 h-3.5" /> Unmute
        </button>
      )}
    </div>
  );
}
