import { useRef, useState, useCallback, useEffect } from "react";
import { useParams, Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetRecording,
  useListRelatedRecordings,
  useGetReactions,
  useToggleReaction,
  getGetRecordingQueryKey,
} from "@workspace/api-client-react";
import { Layout } from "@/components/Layout";
import { CommentSection } from "@/components/CommentSection";
import { Skeleton } from "@/components/ui/skeleton";
import { formatBytes, formatRelativeTime } from "@/lib/formatters";
import { getSessionId } from "@/lib/session";
import { isBookmarked, toggleBookmark, addToHistory } from "@/lib/bookmarks";
import {
  Eye, HardDrive, MonitorPlay, AlertCircle, ArrowLeft, Maximize2, Minimize2,
  Calendar, User, Tag, Clapperboard, ThumbsUp, ThumbsDown, Bookmark, Share2,
  Check, Server, Film, Download, Clock,
} from "lucide-react";

function useFullscreen(ref: React.RefObject<HTMLElement | null>) {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const enter = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    if (el.requestFullscreen) el.requestFullscreen();
    else if ((el as any).webkitRequestFullscreen) (el as any).webkitRequestFullscreen();
    setIsFullscreen(true);
  }, [ref]);
  const exit = useCallback(() => {
    if (document.exitFullscreen) document.exitFullscreen();
    else if ((document as any).webkitExitFullscreen) (document as any).webkitExitFullscreen();
    setIsFullscreen(false);
  }, []);
  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);
  return { isFullscreen, enter, exit };
}

function deriveServers(embedUrl?: string | null, previewUrl?: string | null) {
  const servers: { label: string; src: string; type: "iframe" | "img" }[] = [];
  if (embedUrl) {
    servers.push({ label: "Server 1", src: embedUrl, type: "iframe" });
    const streamtapeMatch = embedUrl.match(/streamtape\.com\/e\/([^/]+)/);
    if (streamtapeMatch) {
      servers.push({
        label: "Server 2",
        src: `https://streamtape.com/v/${streamtapeMatch[1]}/`,
        type: "iframe",
      });
    }
    const doodMatch = embedUrl.match(/dood(?:stream)?\.(?:com|to|watch|la|pm|wf|re|cx|sh)\/e\/([^/]+)/);
    if (doodMatch) {
      servers.push({ label: "Server 2 (Mirror)", src: embedUrl.replace("/e/", "/d/"), type: "iframe" });
    }
  }
  if (previewUrl) {
    servers.push({ label: "Preview GIF", src: previewUrl, type: "img" });
  }
  return servers;
}

export default function VideoDetail() {
  const { id } = useParams<{ id: string }>();
  const sessionId = getSessionId();
  const playerRef = useRef<HTMLDivElement>(null);
  const { isFullscreen, enter: enterFS, exit: exitFS } = useFullscreen(playerRef);
  const [activeServer, setActiveServer] = useState(0);
  const [bookmarked, setBookmarked] = useState(false);
  const [copied, setCopied] = useState(false);
  const queryClient = useQueryClient();

  const { data: video, isLoading, isError } = useGetRecording(id || "", {
    query: { enabled: !!id, queryKey: getGetRecordingQueryKey(id || "") },
  });

  const { data: related, isLoading: relatedLoading } = useListRelatedRecordings(
    { id: id || "", limit: 12 },
    { query: { enabled: !!id } },
  );

  const { data: reactions, refetch: refetchReactions } = useGetReactions(
    { recording_id: id || "", session_id: sessionId },
    { query: { enabled: !!id } },
  );

  const toggleReaction = useToggleReaction();

  useEffect(() => {
    if (id) setBookmarked(isBookmarked(id));
  }, [id]);

  useEffect(() => {
    if (video) {
      addToHistory({
        id: video.id,
        username: video.username,
        filename: video.filename,
        room_title: video.room_title,
        thumbnail_url: video.thumbnail_url,
        resolution: video.resolution,
        timestamp: video.timestamp,
        saved_at: new Date().toISOString(),
      });
    }
  }, [video]);

  const servers = deriveServers(video?.embed_url, video?.preview_url);
  const currentServer = servers[activeServer] ?? servers[0];

  const handleReaction = (type: "like" | "dislike") => {
    if (!id) return;
    toggleReaction.mutate(
      { data: { recording_id: id, type, session_id: sessionId } },
      { onSuccess: () => refetchReactions() },
    );
  };

  const handleBookmark = () => {
    if (!video) return;
    const isNowBookmarked = toggleBookmark({
      id: video.id,
      username: video.username,
      filename: video.filename,
      room_title: video.room_title,
      thumbnail_url: video.thumbnail_url,
      resolution: video.resolution,
      timestamp: video.timestamp,
      saved_at: new Date().toISOString(),
    });
    setBookmarked(isNowBookmarked);
  };

  const handleShare = () => {
    navigator.clipboard.writeText(window.location.href).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  if (isError) {
    return (
      <Layout>
        <div className="container mx-auto px-4 sm:px-6 py-24 text-center">
          <AlertCircle className="w-10 h-10 text-muted-foreground/40 mx-auto mb-5" />
          <h1 className="text-lg font-bold mb-2">Recording not found</h1>
          <p className="text-sm text-muted-foreground mb-6">
            This video doesn&apos;t exist or was removed.
          </p>
          <Link href="/browse" className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline">
            <ArrowLeft className="w-3.5 h-3.5" /> Back to Browse
          </Link>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="container mx-auto px-4 sm:px-6 py-8 max-w-7xl">
        <Link
          href="/browse"
          className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors mb-6 group"
        >
          <ArrowLeft className="w-3 h-3 group-hover:-translate-x-0.5 transition-transform" />
          Browse
        </Link>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-8">
          {/* ─── Main column ──────────────────────────────────────────── */}
          <div className="space-y-6 min-w-0">
            {/* Server selector */}
            {!isLoading && servers.length > 1 && (
              <div className="flex items-center gap-2">
                <Server className="w-3.5 h-3.5 text-muted-foreground/40 shrink-0" />
                <div className="flex gap-1.5 flex-wrap">
                  {servers.map((s, i) => (
                    <button
                      key={i}
                      onClick={() => setActiveServer(i)}
                      className={`px-3 py-1 text-[11px] font-medium rounded-[2px] border transition-all ${
                        activeServer === i
                          ? "bg-primary text-white border-primary"
                          : "border-border/50 text-muted-foreground hover:border-primary/40 hover:text-foreground"
                      }`}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Player */}
            {isLoading ? (
              <Skeleton className="w-full aspect-video" />
            ) : video ? (
              <div
                ref={playerRef}
                className="relative group aspect-video w-full bg-black overflow-hidden rounded-sm"
              >
                {currentServer?.type === "iframe" ? (
                  <iframe
                    key={currentServer.src}
                    src={currentServer.src}
                    className="w-full h-full border-0"
                    allowFullScreen
                    allow="autoplay; fullscreen; picture-in-picture"
                    title={video.room_title || video.filename}
                  />
                ) : currentServer?.type === "img" ? (
                  <img
                    src={currentServer.src}
                    alt={video.filename}
                    className="w-full h-full object-contain"
                  />
                ) : video.thumbnail_url ? (
                  <img
                    src={video.thumbnail_url}
                    alt={video.filename}
                    className="w-full h-full object-contain"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <Clapperboard className="w-12 h-12 text-muted-foreground/20" />
                  </div>
                )}

                <button
                  onClick={isFullscreen ? exitFS : enterFS}
                  className="absolute bottom-3 right-3 z-10 w-8 h-8 flex items-center justify-center bg-black/60 hover:bg-black/80 text-white/70 hover:text-white rounded transition-all opacity-0 group-hover:opacity-100"
                  aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
                >
                  {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
                </button>
              </div>
            ) : null}

            {/* Video info */}
            {isLoading ? (
              <div className="space-y-3">
                <Skeleton className="h-6 w-2/3" />
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-px w-full" />
              </div>
            ) : video ? (
              <div className="space-y-5">
                {/* Title + performer */}
                <div>
                  <h1 className="text-base sm:text-lg font-bold tracking-tight leading-snug mb-2">
                    {video.room_title || video.filename}
                  </h1>
                  <Link
                    href={`/performers/${video.username}`}
                    className="inline-flex items-center gap-1.5 text-sm text-primary hover:text-primary/80 font-medium transition-colors"
                  >
                    <User className="w-3.5 h-3.5" />
                    {video.username}
                  </Link>
                </div>

                {/* Metadata strip */}
                <div className="flex flex-wrap gap-3 sm:gap-5 py-4 border-y border-border/40 text-xs text-muted-foreground">
                  {video.viewers != null && video.viewers > 0 && (
                    <span className="flex items-center gap-1.5">
                      <Eye className="w-3.5 h-3.5 text-primary/60" />
                      <strong className="text-foreground">{video.viewers.toLocaleString()}</strong>{" "}
                      viewers
                    </span>
                  )}
                  {video.resolution && (
                    <span className="flex items-center gap-1.5">
                      <MonitorPlay className="w-3.5 h-3.5 text-primary/60" />
                      <strong className="text-foreground">{video.resolution}</strong>
                    </span>
                  )}
                  {video.framerate && (
                    <span className="flex items-center gap-1.5">
                      <Film className="w-3.5 h-3.5 text-primary/60" />
                      <strong className="text-foreground">{video.framerate}fps</strong>
                    </span>
                  )}
                  {video.filesize ? (
                    <span className="flex items-center gap-1.5">
                      <HardDrive className="w-3.5 h-3.5 text-primary/60" />
                      <strong className="text-foreground">{formatBytes(video.filesize)}</strong>
                    </span>
                  ) : null}
                  {video.timestamp && (
                    <span className="flex items-center gap-1.5">
                      <Calendar className="w-3.5 h-3.5 text-primary/60" />
                      {formatRelativeTime(video.timestamp)}
                    </span>
                  )}
                </div>

                {/* Action bar: like · dislike · bookmark · share · download */}
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={() => handleReaction("like")}
                    className={`inline-flex items-center gap-1.5 h-8 px-3 text-xs font-medium rounded-[2px] border transition-all ${
                      reactions?.user_reaction === "like"
                        ? "bg-primary/10 border-primary/40 text-primary"
                        : "border-border/50 text-muted-foreground hover:border-primary/30 hover:text-foreground"
                    }`}
                  >
                    <ThumbsUp className="w-3.5 h-3.5" />
                    {reactions?.likes != null && reactions.likes > 0 && (
                      <span>{reactions.likes.toLocaleString()}</span>
                    )}
                    Like
                  </button>

                  <button
                    onClick={() => handleReaction("dislike")}
                    className={`inline-flex items-center gap-1.5 h-8 px-3 text-xs font-medium rounded-[2px] border transition-all ${
                      reactions?.user_reaction === "dislike"
                        ? "bg-destructive/10 border-destructive/40 text-destructive"
                        : "border-border/50 text-muted-foreground hover:border-border hover:text-foreground"
                    }`}
                  >
                    <ThumbsDown className="w-3.5 h-3.5" />
                    {reactions?.dislikes != null && reactions.dislikes > 0 && (
                      <span>{reactions.dislikes.toLocaleString()}</span>
                    )}
                    Dislike
                  </button>

                  <button
                    onClick={handleBookmark}
                    className={`inline-flex items-center gap-1.5 h-8 px-3 text-xs font-medium rounded-[2px] border transition-all ${
                      bookmarked
                        ? "bg-amber-500/10 border-amber-500/40 text-amber-500"
                        : "border-border/50 text-muted-foreground hover:border-border hover:text-foreground"
                    }`}
                  >
                    <Bookmark className={`w-3.5 h-3.5 ${bookmarked ? "fill-amber-500" : ""}`} />
                    {bookmarked ? "Saved" : "Save"}
                  </button>

                  <button
                    onClick={handleShare}
                    className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-medium rounded-[2px] border border-border/50 text-muted-foreground hover:border-border hover:text-foreground transition-all"
                  >
                    {copied ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-green-500" />
                        Copied!
                      </>
                    ) : (
                      <>
                        <Share2 className="w-3.5 h-3.5" />
                        Share
                      </>
                    )}
                  </button>

                  {video.embed_url && (
                    <a
                      href={video.embed_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-medium rounded-[2px] border border-border/50 text-muted-foreground hover:border-border hover:text-foreground transition-all"
                    >
                      <Download className="w-3.5 h-3.5" />
                      Open source
                    </a>
                  )}

                  <Link
                    href="/history"
                    className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-medium rounded-[2px] border border-border/50 text-muted-foreground hover:border-border hover:text-foreground transition-all"
                  >
                    <Clock className="w-3.5 h-3.5" />
                    History
                  </Link>
                </div>

                {/* Tags */}
                {video.tags && video.tags.length > 0 && (
                  <div className="space-y-3">
                    <p className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.25em] text-muted-foreground font-semibold">
                      <Tag className="w-3 h-3" />
                      Tags
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {video.tags.map((tag) => (
                        <Link key={tag} href={`/browse?tags=${encodeURIComponent(tag)}`}>
                          <span className="inline-block px-2.5 py-1 text-[11px] border border-border/50 text-muted-foreground hover:border-primary/50 hover:text-primary hover:bg-primary/5 transition-all cursor-pointer rounded-[2px]">
                            {tag}
                          </span>
                        </Link>
                      ))}
                    </div>
                  </div>
                )}

                {/* Browse by gender */}
                {video.gender && (
                  <div className="text-xs text-muted-foreground/60 pt-1">
                    <Link
                      href={`/browse?gender=${encodeURIComponent(video.gender)}`}
                      className="hover:text-muted-foreground transition-colors capitalize"
                    >
                      Browse {video.gender} recordings →
                    </Link>
                  </div>
                )}

                {/* Comments */}
                <div className="pt-4 border-t border-border/30">
                  <CommentSection recordingId={id || ""} />
                </div>
              </div>
            ) : null}
          </div>

          {/* ─── Sidebar — Related ────────────────────────────────────── */}
          <div className="space-y-4">
            <p className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground font-semibold">
              More from {video?.username ?? "this performer"}
            </p>

            {relatedLoading ? (
              <div className="space-y-4">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="flex gap-3">
                    <Skeleton className="w-28 aspect-video shrink-0" />
                    <div className="flex-1 space-y-1.5 pt-0.5">
                      <Skeleton className="h-3 w-full" />
                      <Skeleton className="h-3 w-2/3" />
                      <Skeleton className="h-3 w-1/2" />
                    </div>
                  </div>
                ))}
              </div>
            ) : related && related.filter((r) => r.id !== id).length > 0 ? (
              <div className="space-y-3">
                {related
                  .filter((r) => r.id !== id)
                  .map((rec) => (
                    <Link key={rec.id} href={`/video/${rec.id}`} className="group flex gap-3 outline-none">
                      <div className="w-28 aspect-video shrink-0 overflow-hidden bg-secondary rounded-[2px]">
                        {rec.thumbnail_url ? (
                          <img
                            src={rec.thumbnail_url}
                            alt={rec.filename}
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                            loading="lazy"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <Clapperboard className="w-4 h-4 text-muted-foreground/20" />
                          </div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0 flex flex-col justify-center gap-0.5">
                        <h4 className="text-[11px] font-medium line-clamp-2 leading-snug text-foreground/80 group-hover:text-foreground transition-colors">
                          {rec.room_title || rec.filename}
                        </h4>
                        <p className="text-[10px] text-muted-foreground/50">
                          {formatRelativeTime(rec.timestamp)}
                        </p>
                        {rec.resolution && (
                          <p className="text-[10px] text-muted-foreground/40">{rec.resolution}</p>
                        )}
                      </div>
                    </Link>
                  ))}

                {video?.username && (
                  <Link
                    href={`/performers/${video.username}`}
                    className="block pt-2 text-[11px] text-primary/70 hover:text-primary transition-colors"
                  >
                    All recordings by {video.username} →
                  </Link>
                )}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground/40">No related recordings found.</p>
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
}
