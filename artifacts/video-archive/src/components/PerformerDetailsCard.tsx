import { ExternalLink, Users, Eye, Calendar, Film, CheckCircle, XCircle, Loader2 } from "lucide-react";
import { type PerformerLookupResult } from "@/lib/api";

function formatRelativeTime(timestamp: string): string {
  const diff = Date.now() - new Date(timestamp).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

function proxyUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const { hostname } = new URL(url);
    if (["pixhost.to", "lobfile.com"].some((h) => hostname.includes(h))) {
      return `/api/media?url=${encodeURIComponent(url)}`;
    }
  } catch {}
  return url;
}

interface LoadingStateProps {
  platform: string;
  username: string;
}

function StateContainer({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center py-6 gap-2.5 bg-secondary/30 rounded-lg border border-border/20">
      {children}
    </div>
  );
}

export function PerformerLookupLoading({ platform, username }: LoadingStateProps) {
  return (
    <StateContainer>
      <Loader2 className="w-6 h-6 text-primary/60 animate-spin" />
      <p className="text-xs text-muted-foreground">
        Checking <span className="font-semibold text-foreground">{platform}</span> for{" "}
        <span className="font-semibold text-foreground">@{username}</span>
      </p>
    </StateContainer>
  );
}

interface NotFoundStateProps {
  platform: string;
  username: string;
  onRetry: () => void;
}

export function PerformerLookupNotFound({ platform, username, onRetry }: NotFoundStateProps) {
  return (
    <StateContainer>
      <XCircle className="w-8 h-8 text-destructive/50" />
      <div className="text-center">
        <p className="text-xs font-medium text-foreground">Performer not found</p>
        <p className="text-[11px] text-muted-foreground mt-0.5">
          @{username} doesn&apos;t exist on {platform}
        </p>
      </div>
      <button onClick={onRetry} className="text-[11px] text-primary hover:underline">
        Try another username
      </button>
    </StateContainer>
  );
}

interface ErrorStateProps {
  message: string;
  onRetry: () => void;
}

export function PerformerLookupError({ message, onRetry }: ErrorStateProps) {
  return (
    <StateContainer>
      <XCircle className="w-8 h-8 text-destructive/50" />
      <div className="text-center">
        <p className="text-xs font-medium text-foreground">Lookup failed</p>
        <p className="text-[11px] text-muted-foreground mt-0.5">{message}</p>
      </div>
      <button onClick={onRetry} className="text-[11px] text-primary hover:underline">
        Try again
      </button>
    </StateContainer>
  );
}

interface PerformerDetailsCardProps {
  data: PerformerLookupResult;
}

export function PerformerDetailsCard({ data }: PerformerDetailsCardProps) {
  const platformColor = data.platform === "chaturbate" ? "bg-emerald-500/10 text-emerald-400" : "bg-violet-500/10 text-violet-400";
  const platformLabel = data.platform === "chaturbate" ? "Chaturbate" : "Stripchat";
  const thumbnail = data.avatar_url || proxyUrl(data.archive_thumbnail);

  return (
    <div className="rounded-lg border border-border/30 bg-card overflow-hidden">
      <div className="flex items-start gap-3 p-3.5">
        <div className="relative shrink-0">
          <div className="w-14 h-14 rounded-lg overflow-hidden ring-1 ring-border/30 bg-secondary/50">
            {thumbnail ? (
              <img
                src={thumbnail}
                alt={data.username}
                className="w-full h-full object-cover"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = "none";
                }}
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <span className="text-lg font-black text-muted-foreground/25">
                  {data.username.charAt(0).toUpperCase()}
                </span>
              </div>
            )}
          </div>
          {data.is_online !== undefined && (
            <span
              className={`absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-card ${
                data.is_online ? "bg-green-500" : "bg-neutral-500"
              }`}
            />
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-0.5">
            <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${platformColor}`}>
              {platformLabel}
            </span>
            {data.exists && (
              <CheckCircle className="w-3 h-3 text-green-500" />
            )}
          </div>
          <h3 className="text-sm font-bold text-foreground truncate">
            {data.display_name || data.username}
          </h3>
          <p className="text-[11px] text-muted-foreground/70">@{data.username}</p>
        </div>
      </div>

      <div className="px-3.5 pb-3.5 space-y-2">
        {data.is_online !== undefined && (
          <div className="flex items-center gap-2 text-xs">
            {data.is_online ? (
              <>
                <span className="relative flex h-1.5 w-1.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-green-500" />
                </span>
                <span className="font-medium text-green-500 text-[11px]">Live now</span>
                {data.viewer_count !== undefined && (
                  <span className="text-muted-foreground text-[11px]">
                    <Eye className="inline w-2.5 h-2.5 mr-0.5" />
                    {data.viewer_count.toLocaleString()}
                  </span>
                )}
              </>
            ) : (
              <>
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-neutral-500" />
                <span className="text-muted-foreground text-[11px]">
                  Offline
                  {data.last_seen && (
                    <span className="ml-1">— Last live: {data.last_seen}</span>
                  )}
                </span>
              </>
            )}
          </div>
        )}

        {data.room_title && (
          <p className="text-[11px] text-muted-foreground/60 italic truncate">
            &ldquo;{data.room_title}&rdquo;
          </p>
        )}

        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground/70">
          {data.follower_count !== undefined && (
            <span className="flex items-center gap-1">
              <Users className="w-2.5 h-2.5" />
              {data.follower_count >= 1000
                ? `${(data.follower_count / 1000).toFixed(1)}k`
                : data.follower_count}{" "}
              followers
            </span>
          )}
          {data.in_archive && data.archive_recording_count !== undefined && (
            <span className="flex items-center gap-1">
              <Film className="w-2.5 h-2.5" />
              {data.archive_recording_count} recording{data.archive_recording_count !== 1 ? "s" : ""}
            </span>
          )}
          {data.archive_last_recording && (
            <span className="flex items-center gap-1">
              <Calendar className="w-2.5 h-2.5" />
              {formatRelativeTime(data.archive_last_recording)}
            </span>
          )}
        </div>

        {data.platform_check_failed && data.in_archive && (
          <p className="text-[10px] text-amber-500/60">
            Platform offline, showing archive data
          </p>
        )}

        <a
          href={data.profile_url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
        >
          View on {platformLabel}
          <ExternalLink className="w-2.5 h-2.5" />
        </a>
      </div>
    </div>
  );
}
