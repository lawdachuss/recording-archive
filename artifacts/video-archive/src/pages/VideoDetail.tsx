import { useRef, useState, useCallback, useEffect } from "react";
import { useParams, Link, useLocation } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  useGetRecording,
  useListRelatedRecordings,
  useGetReactions,
  useToggleReaction,
  getGetRecordingQueryKey,
  getListRelatedRecordingsQueryKey,
  getGetReactionsQueryKey,
} from "@workspace/api-client-react";
import { Layout } from "@/components/Layout";
import { CommentSection } from "@/components/CommentSection";
import { Skeleton } from "@/components/ui/skeleton";
import { OptimizedImage } from "@/components/ui/optimized-image";
import { formatBytes, formatRelativeTime } from "@/lib/formatters";
import { getSessionId } from "@/lib/session";
import {
  isBookmarked, toggleBookmark,
  isInWatchLater, toggleWatchLater,
  addToHistory,
} from "@/lib/bookmarks";
import {
  getCollections, addToCollection, createCollection, type Collection,
} from "@/lib/collections";
import { useAuth } from "@/contexts/AuthContext";
import { userApi, recordingToMeta, type CloudCollection } from "@/lib/user-api";
import {
  Eye, HardDrive, MonitorPlay, AlertCircle, ArrowLeft, Maximize2, Minimize2,
  Calendar, User, Tag, Clapperboard, ThumbsUp, ThumbsDown, Bookmark, Share2,
  Check, Server, Film, Download, Clock, Play, Code2, ListVideo, Shuffle,
  FolderPlus, Plus, ChevronDown, ExternalLink,
} from "lucide-react";

function useFullscreen(ref: React.RefObject<HTMLElement | null>) {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const enter = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    if (el.requestFullscreen) el.requestFullscreen();
    else if ((el as any).webkitRequestFullscreen) (el as any).webkitRequestFullscreen();
  }, [ref]);
  const exit = useCallback(() => {
    if (document.exitFullscreen) document.exitFullscreen();
    else if ((document as any).webkitExitFullscreen) (document as any).webkitExitFullscreen();
  }, []);
  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);
  return { isFullscreen, enter, exit };
}

function detectHostLabel(url: string): string {
  try {
    const { hostname } = new URL(url);
    if (hostname.includes("streamtape")) return "Streamtape";
    if (hostname.includes("voe")) return "VOE";
    if (hostname.includes("mixdrop")) return "Mixdrop";
    if (hostname.includes("dood")) return "DoodStream";
    if (hostname.includes("filemoon")) return "Filemoon";
    if (hostname.includes("upstream")) return "Upstream";
    if (hostname.includes("vidoza")) return "Vidoza";
    if (hostname.includes("mp4upload")) return "MP4Upload";
    return hostname.replace(/^www\./, "");
  } catch {
    return "Server";
  }
}

function isEmbedUrl(url: string): boolean {
  try {
    const { pathname } = new URL(url);
    return pathname.includes("/e/") || pathname.includes("/embed/") || pathname.includes("/player/");
  } catch {
    return false;
  }
}

function deriveServers(
  embedUrl?: string | null,
  previewUrl?: string | null,
  links?: Record<string, string> | null,
) {
  const servers: { label: string; src: string; type: "iframe" | "img" | "link" }[] = [];
  const seen = new Set<string>();
  const seenHosts = new Set<string>();

  if (links) {
    for (const [label, src] of Object.entries(links)) {
      if (src) {
        let url = src;
        try {
          const parsed = new URL(url);
          if (parsed.hostname.includes("voe") && !parsed.pathname.startsWith("/e/")) {
            url = parsed.origin + "/e" + parsed.pathname;
          }
        } catch {}
        if (isEmbedUrl(url)) {
          servers.push({ label, src: url, type: "iframe" });
        } else {
          servers.push({ label, src: url, type: "link" });
        }
        seen.add(url);
        try { seenHosts.add(new URL(url).hostname); } catch {}
      }
    }
  }

  if (embedUrl && !seen.has(embedUrl)) {
    let hostDuplicate = false;
    try { hostDuplicate = seenHosts.has(new URL(embedUrl).hostname); } catch {}
    if (!hostDuplicate) {
      servers.push({ label: detectHostLabel(embedUrl), src: embedUrl, type: "iframe" });
      seen.add(embedUrl);
    }
  }

  if (previewUrl && !seen.has(previewUrl)) {
    if (isEmbedUrl(previewUrl)) {
      servers.push({ label: detectHostLabel(previewUrl), src: previewUrl, type: "iframe" });
    } else {
      servers.push({ label: "Preview", src: previewUrl, type: "img" });
    }
  }

  return servers;
}

export default function VideoDetail() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const sessionId = getSessionId();
  const playerRef = useRef<HTMLDivElement>(null);
  const { isFullscreen, enter: enterFS, exit: exitFS } = useFullscreen(playerRef);
  const { user } = useAuth();

  const [activeServer, setActiveServer] = useState(0);
  const [videoStarted, setVideoStarted] = useState(false);
  const [bookmarked, setBookmarked] = useState(false);
  const [watchLater, setWatchLater] = useState(false);
  const [copied, setCopied] = useState(false);
  const [embedCopied, setEmbedCopied] = useState(false);
  const [collectionOpen, setCollectionOpen] = useState(false);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [cloudCollections, setCloudCollections] = useState<CloudCollection[]>([]);
  const [newColName, setNewColName] = useState("");
  const [addedToCol, setAddedToCol] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const { data: video, isLoading, isError } = useGetRecording(id || "", {
    query: { enabled: !!id, queryKey: getGetRecordingQueryKey(id || "") },
  });

  const { data: related, isLoading: relatedLoading } = useListRelatedRecordings(
    { id: id || "", limit: 12 },
    { query: { enabled: !!id, queryKey: getListRelatedRecordingsQueryKey({ id: id || "", limit: 12 }) } },
  );

  const { data: reactions, refetch: refetchReactions } = useGetReactions(
    { recording_id: id || "", session_id: sessionId },
    { query: { enabled: !!id, queryKey: getGetReactionsQueryKey({ recording_id: id || "", session_id: sessionId }) } },
  );

  const toggleReaction = useToggleReaction();

  useEffect(() => {
    setVideoStarted(false);
    setActiveServer(0);
    setCollectionOpen(false);
    setAddedToCol(null);
    if (id) {
      if (!user) {
        setBookmarked(isBookmarked(id));
        setWatchLater(isInWatchLater(id));
      } else {
        userApi.getSaved().then((items) => {
          setBookmarked(items.some((i) => i.recording_id === id));
        }).catch(() => {});
        userApi.getWatchLater().then((items) => {
          setWatchLater(items.some((i) => i.recording_id === id));
        }).catch(() => {});
      }
    }
  }, [id, user]);

  useEffect(() => {
    if (collectionOpen) {
      if (user) {
        userApi.getCollections().then(setCloudCollections).catch(() => {});
      } else {
        setCollections(getCollections());
      }
    }
  }, [collectionOpen, user]);

  const getVideoMeta = () => {
    if (!video) return null;
    return {
      id: video.id,
      username: video.username,
      filename: video.filename,
      room_title: video.room_title,
      thumbnail_url: video.thumbnail_url,
      sprite_url: video.sprite_url,
      preview_url: video.preview_url,
      resolution: video.resolution,
      timestamp: video.timestamp,
      saved_at: new Date().toISOString(),
    };
  };

  const handleAddToCollection = async (colId: string) => {
    const meta = getVideoMeta();
    if (!meta) return;
    if (user) {
      await userApi.addCollectionItem(colId, meta.id, recordingToMeta(meta));
    } else {
      addToCollection(colId, meta);
    }
    setAddedToCol(colId);
    setTimeout(() => {
      setCollectionOpen(false);
      setAddedToCol(null);
    }, 1200);
  };

  const handleCreateAndAdd = async () => {
    if (!newColName.trim()) return;
    const meta = getVideoMeta();
    if (!meta) return;
    if (user) {
      const col = await userApi.createCollection(newColName.trim());
      await userApi.addCollectionItem(col.id, meta.id, recordingToMeta(meta));
      setCloudCollections((prev) => [{ ...col, item_count: 1 }, ...prev]);
      setAddedToCol(col.id);
    } else {
      const col = createCollection(newColName.trim());
      addToCollection(col.id, meta);
      setCollections((prev) => [col, ...prev]);
      setAddedToCol(col.id);
    }
    setNewColName("");
    setTimeout(() => {
      setCollectionOpen(false);
      setAddedToCol(null);
    }, 1200);
  };

  useEffect(() => {
    if (!video) return;
    const meta = {
      id: video.id,
      username: video.username,
      filename: video.filename,
      room_title: video.room_title,
      thumbnail_url: video.thumbnail_url,
      sprite_url: video.sprite_url,
      preview_url: video.preview_url,
      resolution: video.resolution,
      timestamp: video.timestamp,
      saved_at: new Date().toISOString(),
    };
    if (user) {
      userApi.addHistory(video.id, recordingToMeta(meta)).catch(() => {});
    } else {
      addToHistory(meta);
    }
  }, [video, user]);

  useEffect(() => {
    if (!video?.thumbnail_url) return;
    const img = new Image();
    img.fetchPriority = "high";
    img.src = video.thumbnail_url;
  }, [video?.thumbnail_url]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "f" || e.key === "F") {
        isFullscreen ? exitFS() : enterFS();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [isFullscreen, enterFS, exitFS]);

  const servers = deriveServers(video?.embed_url, video?.preview_url, video?.links);
  const currentServer = servers[activeServer] ?? servers[0];

  const handleReaction = (type: "like" | "dislike") => {
    if (!id) return;
    toggleReaction.mutate(
      { data: { recording_id: id, type, session_id: sessionId } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({
            queryKey: getGetReactionsQueryKey({ recording_id: id, session_id: sessionId }),
          });
          refetchReactions();
        },
      },
    );
  };

  const handleBookmark = async () => {
    if (!video) return;
    const savedRec = {
      id: video.id,
      username: video.username,
      filename: video.filename,
      room_title: video.room_title,
      thumbnail_url: video.thumbnail_url,
      sprite_url: video.sprite_url,
      preview_url: video.preview_url,
      resolution: video.resolution,
      timestamp: video.timestamp,
      saved_at: new Date().toISOString(),
    };
    if (user) {
      if (bookmarked) {
        await userApi.removeSaved(video.id).catch(() => {});
        setBookmarked(false);
      } else {
        await userApi.addSaved(video.id, recordingToMeta(savedRec)).catch(() => {});
        setBookmarked(true);
      }
    } else {
      setBookmarked(toggleBookmark(savedRec));
    }
  };

  const handleWatchLater = async () => {
    if (!video) return;
    const savedRec = {
      id: video.id,
      username: video.username,
      filename: video.filename,
      room_title: video.room_title,
      thumbnail_url: video.thumbnail_url,
      sprite_url: video.sprite_url,
      preview_url: video.preview_url,
      resolution: video.resolution,
      timestamp: video.timestamp,
      saved_at: new Date().toISOString(),
    };
    if (user) {
      if (watchLater) {
        await userApi.removeWatchLater(video.id).catch(() => {});
        setWatchLater(false);
      } else {
        await userApi.addWatchLater(video.id, recordingToMeta(savedRec)).catch(() => {});
        setWatchLater(true);
      }
    } else {
      setWatchLater(toggleWatchLater(savedRec));
    }
  };

  const handleShare = () => {
    navigator.clipboard.writeText(window.location.href).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    });
  };

  const handleCopyEmbed = () => {
    if (!currentServer?.src) return;
    const code = `<iframe src="${currentServer.src}" width="960" height="540" frameborder="0" allowfullscreen allow="autoplay; fullscreen"></iframe>`;
    navigator.clipboard.writeText(code).then(() => {
      setEmbedCopied(true);
      setTimeout(() => setEmbedCopied(false), 2500);
    });
  };

  const totalReactions = (reactions?.likes ?? 0) + (reactions?.dislikes ?? 0);
  const likePercent = totalReactions > 0 ? Math.round(((reactions?.likes ?? 0) / totalReactions) * 100) : null;

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
        <div className="flex items-center justify-between mb-6">
          <Link
            href="/browse"
            className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors group"
          >
            <ArrowLeft className="w-3 h-3 group-hover:-translate-x-0.5 transition-transform" />
            Browse
          </Link>
          <button
            onClick={() => setLocation("/random")}
            className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
          >
            <Shuffle className="w-3 h-3" />
            Random
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-8">
          {/* ─── Main column ──────────────────────────────────── */}
          <div className="space-y-5 min-w-0">
            {/* Server selector */}
            {!isLoading && servers.length > 1 && (
              <div className="flex items-center gap-2">
                <Server className="w-3.5 h-3.5 text-muted-foreground/40 shrink-0" />
                <div className="flex gap-1.5 flex-wrap">
                  {servers.map((s, i) => (
                    <button
                      key={i}
                      onClick={() => { setActiveServer(i); setVideoStarted(false); }}
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

            {/* Player — click-to-play */}
            {isLoading ? (
              <Skeleton className="w-full aspect-video" />
            ) : video ? (
              <div
                ref={playerRef}
                className="relative group aspect-video w-full bg-black overflow-hidden rounded-sm"
              >
                {currentServer?.type === "iframe" && !videoStarted ? (
                  /* Poster / click-to-play */
                  <button
                    className="absolute inset-0 w-full h-full cursor-pointer focus:outline-none"
                    onClick={() => setVideoStarted(true)}
                    aria-label="Play video"
                  >
                    {video.thumbnail_url ? (
                      <OptimizedImage
                        src={video.thumbnail_url}
                        alt={video.username}
                        className="w-full h-full object-cover"
                        containerClassName="w-full h-full"
                        fetchPriority="high"
                        loading="eager"
                        fallback={
                          <div className="w-full h-full bg-black flex items-center justify-center">
                            <Clapperboard className="w-12 h-12 text-white/10" />
                          </div>
                        }
                      />
                    ) : (
                      <div className="w-full h-full bg-black flex items-center justify-center">
                        <Clapperboard className="w-12 h-12 text-white/10" />
                      </div>
                    )}
                    <div className="absolute inset-0 bg-black/30 flex flex-col items-center justify-center gap-3">
                      <div className="w-16 h-16 rounded-full bg-primary/90 hover:bg-primary flex items-center justify-center shadow-lg shadow-primary/30 transition-all hover:scale-105">
                        <Play className="w-7 h-7 text-white fill-white ml-1" />
                      </div>
                      <span className="text-white/80 text-xs font-medium">Click to play</span>
                    </div>
                    {video.resolution && (
                      <div className="absolute top-3 right-3 text-[10px] font-bold text-white/80 bg-black/60 px-2 py-0.5 rounded-[2px]">
                        {video.resolution}
                      </div>
                    )}
                  </button>
                ) : currentServer?.type === "link" ? (
                  <div className="w-full h-full flex flex-col items-center justify-center gap-4 bg-black/80 p-8">
                    <p className="text-muted-foreground text-sm text-center">
                      Open this video on the host site:
                    </p>
                    <a
                      href={currentServer.src}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 px-5 py-2.5 rounded bg-primary text-white text-sm font-medium hover:bg-primary/90 transition-colors"
                    >
                      <ExternalLink className="w-4 h-4" />
                      Open on {currentServer.label}
                    </a>
                  </div>
                ) : currentServer?.type === "iframe" ? (
                  <iframe
                    key={`${currentServer.src}-${activeServer}`}
                    src={currentServer.src}
                    className="w-full h-full border-0"
                    allowFullScreen
                    allow="autoplay; fullscreen; picture-in-picture"
                    title={video.room_title || video.filename}
                  />
                ) : currentServer?.type === "img" ? (
                  <OptimizedImage
                    src={currentServer.src}
                    alt={video.filename}
                    className="w-full h-full object-contain"
                    containerClassName="w-full h-full"
                    fallback={
                      <div className="w-full h-full flex items-center justify-center">
                        <Clapperboard className="w-12 h-12 text-muted-foreground/20" />
                      </div>
                    }
                  />
                ) : video.thumbnail_url ? (
                  <OptimizedImage
                    src={video.thumbnail_url}
                    alt={video.filename}
                    className="w-full h-full object-contain"
                    containerClassName="w-full h-full"
                    fallback={
                      <div className="w-full h-full flex items-center justify-center">
                        <Clapperboard className="w-12 h-12 text-muted-foreground/20" />
                      </div>
                    }
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <Clapperboard className="w-12 h-12 text-muted-foreground/20" />
                  </div>
                )}

                {videoStarted && (
                  <button
                    onClick={isFullscreen ? exitFS : enterFS}
                    className="absolute bottom-3 right-3 z-10 w-8 h-8 flex items-center justify-center bg-black/60 hover:bg-black/80 text-white/70 hover:text-white rounded transition-all opacity-0 group-hover:opacity-100"
                    aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
                    title="Fullscreen (F)"
                  >
                    {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
                  </button>
                )}
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

                {/* Action bar */}
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
                    {reactions?.likes != null && reactions.likes > 0 && <span>{reactions.likes.toLocaleString()}</span>}
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
                    {reactions?.dislikes != null && reactions.dislikes > 0 && <span>{reactions.dislikes.toLocaleString()}</span>}
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
                    onClick={handleWatchLater}
                    className={`inline-flex items-center gap-1.5 h-8 px-3 text-xs font-medium rounded-[2px] border transition-all ${
                      watchLater
                        ? "bg-blue-500/10 border-blue-500/40 text-blue-400"
                        : "border-border/50 text-muted-foreground hover:border-border hover:text-foreground"
                    }`}
                  >
                    <ListVideo className="w-3.5 h-3.5" />
                    {watchLater ? "Queued" : "Watch Later"}
                  </button>

                  <button
                    onClick={handleShare}
                    className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-medium rounded-[2px] border border-border/50 text-muted-foreground hover:border-border hover:text-foreground transition-all"
                  >
                    {copied ? (
                      <><Check className="w-3.5 h-3.5 text-green-500" /> Copied!</>
                    ) : (
                      <><Share2 className="w-3.5 h-3.5" /> Share</>
                    )}
                  </button>

                  {currentServer?.src && currentServer.type === "iframe" && (
                    <button
                      onClick={handleCopyEmbed}
                      className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-medium rounded-[2px] border border-border/50 text-muted-foreground hover:border-border hover:text-foreground transition-all"
                    >
                      {embedCopied ? (
                        <><Check className="w-3.5 h-3.5 text-green-500" /> Copied!</>
                      ) : (
                        <><Code2 className="w-3.5 h-3.5" /> Embed</>
                      )}
                    </button>
                  )}

                  {video.embed_url && (
                    <a
                      href={video.embed_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-medium rounded-[2px] border border-border/50 text-muted-foreground hover:border-border hover:text-foreground transition-all"
                    >
                      <Download className="w-3.5 h-3.5" />
                      Source
                    </a>
                  )}

                  {/* Add to Collection dropdown */}
                  <div className="relative">
                    <button
                      onClick={() => setCollectionOpen((v) => !v)}
                      className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-medium rounded-[2px] border border-border/50 text-muted-foreground hover:border-border hover:text-foreground transition-all"
                    >
                      <FolderPlus className="w-3.5 h-3.5" />
                      Collection
                      <ChevronDown className={`w-3 h-3 transition-transform ${collectionOpen ? "rotate-180" : ""}`} />
                    </button>
                    {collectionOpen && (
                      <div className="absolute right-0 sm:left-0 sm:right-auto top-full mt-1 z-50 w-56 glass-dropdown rounded overflow-hidden">
                        <div className="p-2 border-b border-border/40">
                          <div className="flex gap-1">
                            <input
                              autoFocus
                              type="text"
                              placeholder="New collection…"
                              value={newColName}
                              onChange={(e) => setNewColName(e.target.value)}
                              onKeyDown={(e) => { if (e.key === "Enter") handleCreateAndAdd(); }}
                              maxLength={60}
                              className="flex-1 h-7 bg-secondary/60 border border-border/40 focus:border-primary/50 rounded-[2px] px-2 text-xs outline-none"
                            />
                            <button
                              onClick={handleCreateAndAdd}
                              disabled={!newColName.trim()}
                              className="w-7 h-7 flex items-center justify-center bg-primary text-white rounded-[2px] disabled:opacity-40 transition-opacity"
                              title="Create and add"
                            >
                              <Plus className="w-3 h-3" />
                            </button>
                          </div>
                        </div>
                        {(user ? cloudCollections : collections).length === 0 ? (
                          <div className="px-3 py-4 text-center">
                            <p className="text-[11px] text-muted-foreground">No collections yet.</p>
                            <p className="text-[11px] text-muted-foreground/60">Create one above.</p>
                          </div>
                        ) : (
                          <div className="max-h-48 overflow-y-auto">
                            {user
                              ? cloudCollections.map((col) => (
                                  <button
                                    key={col.id}
                                    onClick={() => handleAddToCollection(col.id)}
                                    className="w-full text-left px-3 py-2 text-xs flex items-center gap-2 hover:bg-secondary transition-colors"
                                  >
                                    {addedToCol === col.id ? (
                                      <Check className="w-3 h-3 text-green-500 shrink-0" />
                                    ) : (
                                      <ListVideo className="w-3 h-3 text-muted-foreground/50 shrink-0" />
                                    )}
                                    <span className="truncate">{col.name}</span>
                                    <span className="ml-auto text-[10px] text-muted-foreground/40 shrink-0">
                                      {col.item_count ?? 0}
                                    </span>
                                  </button>
                                ))
                              : collections.map((col) => (
                                  <button
                                    key={col.id}
                                    onClick={() => handleAddToCollection(col.id)}
                                    className="w-full text-left px-3 py-2 text-xs flex items-center gap-2 hover:bg-secondary transition-colors"
                                  >
                                    {addedToCol === col.id ? (
                                      <Check className="w-3 h-3 text-green-500 shrink-0" />
                                    ) : (
                                      <ListVideo className="w-3 h-3 text-muted-foreground/50 shrink-0" />
                                    )}
                                    <span className="truncate">{col.name}</span>
                                    <span className="ml-auto text-[10px] text-muted-foreground/40 shrink-0">
                                      {col.items.length}
                                    </span>
                                  </button>
                                ))
                            }
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  <Link
                    href="/history"
                    className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-medium rounded-[2px] border border-border/50 text-muted-foreground hover:border-border hover:text-foreground transition-all"
                  >
                    <Clock className="w-3.5 h-3.5" />
                    History
                  </Link>
                </div>

                {/* Like ratio bar */}
                {likePercent !== null && totalReactions > 0 && (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-[10px] text-muted-foreground/50">
                      <span>{likePercent}% liked</span>
                      <span>{totalReactions.toLocaleString()} ratings</span>
                    </div>
                    <div className="h-1 bg-secondary rounded-full overflow-hidden">
                      <div
                        className="h-full bg-primary rounded-full transition-all duration-500"
                        style={{ width: `${likePercent}%` }}
                      />
                    </div>
                  </div>
                )}

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

          {/* ─── Sidebar — Related ─────────────────────────── */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground font-semibold">
                More from {video?.username ?? "this performer"}
              </p>
              <button
                onClick={() => setLocation("/random")}
                className="text-[10px] text-muted-foreground/50 hover:text-primary transition-colors flex items-center gap-1"
              >
                <Shuffle className="w-3 h-3" />
                Random
              </button>
            </div>

            {relatedLoading ? (
              <div className="space-y-4">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="flex gap-3">
                    <Skeleton className="w-28 aspect-video shrink-0" />
                    <div className="flex-1 space-y-1.5 pt-0.5">
                      <Skeleton className="h-3 w-full" />
                      <Skeleton className="h-3 w-2/3" />
                    </div>
                  </div>
                ))}
              </div>
            ) : related && related.filter((r) => r.id !== id).length > 0 ? (
              <div className="space-y-3">
                {related
                  .filter((r) => r.id !== id)
                  .map((rec, i) => (
                    <Link key={rec.id} href={`/video/${rec.id}`} className="group flex gap-3 outline-none">
                      <div className="w-28 aspect-video shrink-0 overflow-hidden bg-secondary rounded-[2px] relative">
                        {rec.thumbnail_url ? (
                          <OptimizedImage
                            src={rec.thumbnail_url}
                            alt={rec.username}
                            fetchPriority={i < 2 ? "high" : undefined}
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                            containerClassName="w-full h-full"
                            fallback={
                              <div className="w-full h-full flex items-center justify-center">
                                <Clapperboard className="w-4 h-4 text-muted-foreground/20" />
                              </div>
                            }
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <Clapperboard className="w-4 h-4 text-muted-foreground/20" />
                          </div>
                        )}
                        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/20">
                          <Play className="w-4 h-4 text-white fill-white" />
                        </div>
                      </div>
                      <div className="flex-1 min-w-0 flex flex-col justify-center gap-0.5">
                        <p className="text-[11px] font-semibold text-primary/80 group-hover:text-primary transition-colors truncate">
                          {rec.username}
                        </p>
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
