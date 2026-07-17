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
import { VideoCard } from "@/components/VideoCard";
import { Skeleton } from "@/components/ui/skeleton";
import { OptimizedImage } from "@/components/ui/optimized-image";
import { formatBytes, formatRelativeTime } from "@/lib/formatters";
import { getSessionId } from "@/lib/session";
import { trackView } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { userApi, recordingToMeta, type CloudCollection } from "@/lib/user-api";

import {
  Eye, HardDrive, MonitorPlay, AlertCircle, ArrowLeft, Maximize2, Minimize2,
  Calendar, User, Tag, Clapperboard, ThumbsUp, ThumbsDown, Bookmark, Share2,
  Check, Server, Film, Download, Clock, Play, Code2, ListVideo, Shuffle,
  FolderPlus, Plus, ChevronDown, ExternalLink, LogIn,
} from "lucide-react";

function useFullscreen(ref: React.RefObject<HTMLDivElement | null>) {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const enter = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    // Element has requestFullscreen; add webkit variant for Safari support
    type FullEl = Element & { webkitRequestFullscreen?: () => Promise<void> };
    const fEl = el as FullEl;
    if (fEl.requestFullscreen) fEl.requestFullscreen();
    else if (fEl.webkitRequestFullscreen) fEl.webkitRequestFullscreen();
  }, [ref]);
  const exit = useCallback(() => {
    type FullDoc = Document & { webkitExitFullscreen?: () => void };
    const fDoc = document as FullDoc;
    if (fDoc.exitFullscreen) fDoc.exitFullscreen();
    else if (fDoc.webkitExitFullscreen) fDoc.webkitExitFullscreen();
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
    if (hostname.includes("pixeldrain")) return "Pixeldrain";
    if (hostname.includes("gofile")) return "Gofile";
    if (hostname.includes("streamwish")) return "Streamwish";
    if (hostname.includes("earnvids")) return "EarnVids";
    if (hostname.includes("seek") || hostname.includes("embedseek") || hostname.includes("seeks.cloud")) return "SeekStreaming";
    if (hostname.includes("upns")) return "UPNshare";
    return hostname.replace(/^www\./, "");
  } catch {
    return "Server";
  }
}

function isEmbedUrl(url: string): boolean {
  try {
    const { pathname, hostname } = new URL(url);
    // Path-based detection for common embed patterns
    if (pathname.includes("/e/") || pathname.includes("/embed/") || pathname.includes("/player/") || pathname.includes("/v/")) {
      return true;
    }
    // Host-based detection for known embed-friendly providers
    // Some hosts embed via direct URL without a standard embed path
    if (hostname.includes("seek") || hostname.includes("embedseek") || hostname.includes("seeks.cloud")) {
      return true;
    }
    if (hostname.includes("upns")) {
      return true;
    }
    return false;
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
          // Convert pixeldrain API URLs to user-facing page URLs
          // The API endpoint returns 403 (hotlinking blocked), but /u/{id} page works.
          const pdMatch = parsed.pathname.match(/^\/api\/file\/(.+)/);
          if (parsed.hostname.includes("pixeldrain") && pdMatch) {
            url = `https://pixeldrain.com/u/${pdMatch[1]}`;
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

  const [activeServer, setActiveServer] = useState(() => {
    if (typeof window === "undefined") return 0;
    const stored = sessionStorage.getItem("vserver");
    return stored ? parseInt(stored, 10) : 0;
  });
  const [videoStarted, setVideoStarted] = useState(() => {
    if (typeof window === "undefined") return false;
    return sessionStorage.getItem("vplayed") === id;
  });
  const [bookmarked, setBookmarked] = useState(false);
  const [watchLater, setWatchLater] = useState(false);
  const [copied, setCopied] = useState(false);
  const [embedCopied, setEmbedCopied] = useState(false);
  const [collectionOpen, setCollectionOpen] = useState(false);
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
    setVideoStarted(sessionStorage.getItem("vplayed") === id);
    setActiveServer(() => {
      const stored = sessionStorage.getItem("vserver");
      return stored ? parseInt(stored, 10) : 0;
    });
    setCollectionOpen(false);
    setAddedToCol(null);
    setBookmarked(false);
    setWatchLater(false);
    if (id && user) {
      userApi.getSaved().then((items) => {
        setBookmarked(items.some((i) => i.recording_id === id));
      }).catch(() => {});
      userApi.getWatchLater().then((items) => {
        setWatchLater(items.some((i) => i.recording_id === id));
      }).catch(() => {});
    }
  }, [id, user]);

  useEffect(() => {
    if (collectionOpen && user) {
      userApi.getCollections().then(setCloudCollections).catch(() => {});
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
    if (!meta || !user) return;
    await userApi.addCollectionItem(colId, meta.id, recordingToMeta(meta));
    setAddedToCol(colId);
    setTimeout(() => {
      setCollectionOpen(false);
      setAddedToCol(null);
    }, 1200);
  };

  const handleCreateAndAdd = async () => {
    if (!newColName.trim() || !user) return;
    const meta = getVideoMeta();
    if (!meta) return;
    const col = await userApi.createCollection(newColName.trim());
    await userApi.addCollectionItem(col.id, meta.id, recordingToMeta(meta));
    setCloudCollections((prev) => [{ ...col, item_count: 1 }, ...prev]);
    setAddedToCol(col.id);
    setNewColName("");
    setTimeout(() => {
      setCollectionOpen(false);
      setAddedToCol(null);
    }, 1200);
  };

  useEffect(() => {
    if (!video || !user) return;
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
    userApi.addHistory(video.id, recordingToMeta(meta)).catch(() => {});
    // Only depend on video.id — the full video object changes reference
    // on every background refetch, causing history API spam
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [video?.id, user]);

  // ─── Track view on page load (once per session) ──────────
  useEffect(() => {
    if (!video?.id) return;
    trackView(video.id);
  }, [video?.id]);

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
    if (!id || !user) return;
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
    if (!video || !user) return;
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
    if (bookmarked) {
      await userApi.removeSaved(video.id).catch(() => {});
      setBookmarked(false);
    } else {
      await userApi.addSaved(video.id, recordingToMeta(savedRec)).catch(() => {});
      setBookmarked(true);
    }
  };

  const handleWatchLater = async () => {
    if (!video || !user) return;
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
    if (watchLater) {
      await userApi.removeWatchLater(video.id).catch(() => {});
      setWatchLater(false);
    } else {
      await userApi.addWatchLater(video.id, recordingToMeta(savedRec)).catch(() => {});
      setWatchLater(true);
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
                      onClick={() => { setActiveServer(i); sessionStorage.setItem("vserver", String(i)); setVideoStarted(false); sessionStorage.removeItem("vplayed"); }}
                      className={`px-3 py-1 text-[11px] font-medium rounded-[2px] border transition-all ${
                        activeServer === i
                          ? "border-primary/60 text-primary"
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
                      onClick={() => {
                        setVideoStarted(true);
                        if (id) sessionStorage.setItem("vplayed", id);
                      }}
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
                      <div className="w-16 h-16 rounded-full border-2 border-primary/60 hover:border-primary flex items-center justify-center transition-all hover:scale-105">
                        <Play className="w-7 h-7 text-white fill-white ml-1" />
                      </div>
                      <span className="text-white/80 text-xs font-medium">Click to play</span>
                    </div>
                    {video.resolution && (
                      <div className="absolute top-3 right-3 text-[10px] font-bold text-white/80 bg-black/30 backdrop-blur-sm ring-1 ring-white/10 px-2 py-0.5 rounded-[2px]">
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
                      className="inline-flex items-center gap-2 px-5 py-2.5 rounded border border-primary/30 text-primary text-sm font-medium hover:border-primary/60 transition-colors"
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
                    className="absolute bottom-3 right-3 z-10 w-8 h-8 flex items-center justify-center bg-black/30 backdrop-blur-sm ring-1 ring-white/10 hover:bg-black/50 hover:ring-white/20 text-white/70 hover:text-white rounded transition-all opacity-0 group-hover:opacity-100"
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
                  {user ? (
                    <>
                  <button
                    onClick={() => handleReaction("like")}
                    className={`inline-flex items-center gap-1.5 h-8 px-3 text-xs font-medium rounded-[2px] border transition-all ${
                      reactions?.user_reaction === "like"
                        ? "border-primary/60 text-primary"
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
                        ? "border-destructive/40 text-destructive"
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
                        ? "border-amber-500/40 text-amber-500"
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
                        ? "border-blue-500/40 text-blue-400"
                        : "border-border/50 text-muted-foreground hover:border-border hover:text-foreground"
                    }`}
                  >
                    <ListVideo className="w-3.5 h-3.5" />
                    {watchLater ? "Queued" : "Watch Later"}
                  </button>
                    </>
                  ) : null}

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
                  {user && (
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
                              className="flex-1 h-7 bg-card border border-border/40 focus:border-primary/50 rounded-[2px] px-2 text-xs outline-none"
                            />
                            <button
                              onClick={handleCreateAndAdd}
                              disabled={!newColName.trim()}
                              className="w-7 h-7 flex items-center justify-center border border-primary/30 text-primary rounded-[2px] disabled:opacity-40 hover:border-primary/60 transition-opacity"
                              title="Create and add"
                            >
                              <Plus className="w-3 h-3" />
                            </button>
                          </div>
                        </div>
                        {cloudCollections.length === 0 ? (
                          <div className="px-3 py-4 text-center">
                            <p className="text-[11px] text-muted-foreground">No collections yet.</p>
                            <p className="text-[11px] text-muted-foreground/60">Create one above.</p>
                          </div>
                        ) : (
                          <div className="max-h-48 overflow-y-auto">
                            {cloudCollections.map((col) => (
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
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  )}

                  {user && (
                  <Link
                    href="/history"
                    className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-medium rounded-[2px] border border-border/50 text-muted-foreground hover:border-border hover:text-foreground transition-all"
                  >
                    <Clock className="w-3.5 h-3.5" />
                    History
                  </Link>
                  )}
                </div>

                {/* Sign-in prompt for unauthenticated users */}
                {!user && (
                  <div className="flex items-center gap-2 p-3 border border-border/40 rounded-sm bg-secondary">
                    <LogIn className="w-4 h-4 text-muted-foreground/40" />
                    <p className="text-xs text-muted-foreground/60">
                      <Link href="/login" className="text-primary hover:underline font-medium">Sign in</Link> to like, save, or add to collections
                    </p>
                  </div>
                )}

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
            ) : related && related.filter((r) => r.id !== id && r.username === video?.username).length > 0 ? (
              <div className="space-y-3">
                {related
                  .filter((r) => r.id !== id && r.username === video?.username)
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

        {/* ─── Bottom Recommendations ──────────────────────────── */}
        {!isLoading ? (
          <div className="mt-10 space-y-5">
            <div className="flex flex-col gap-1">
              <p className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground font-semibold">
                Recommendations
              </p>
              <p className="text-[9px] text-muted-foreground/40">
                {user ? "Based on your watch history" : "More like this"}
              </p>
            </div>

            {relatedLoading ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
                {Array.from({ length: 12 }).map((_, i) => (
                  <div key={i} className="space-y-2">
                    <Skeleton className="w-full aspect-video" />
                    <Skeleton className="h-3 w-3/4" />
                    <Skeleton className="h-2 w-1/2" />
                  </div>
                ))}
              </div>
            ) : related && related.filter((r) => r.id !== id).length > 0 ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
                {related
                  .filter((r) => r.id !== id)
                  .map((rec) => (
                    <VideoCard key={rec.id} recording={rec} />
                  ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground/40">No recommendations available.</p>
            )}
          </div>
        ) : null}
      </div>
    </Layout>
  );
}
