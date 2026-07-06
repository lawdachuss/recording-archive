import { useState, useCallback, useMemo, memo } from "react";
import { Link } from "wouter";
import { OptimizedImage } from "@/components/ui/optimized-image";
import { SpriteSlideshow } from "@/components/SpriteSlideshow";
import { Users } from "lucide-react";

const CORS_HOSTS: string[] = ["pixhost.to", "lobfile.com"];

function needsProxy(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const { hostname } = new URL(url);
    return CORS_HOSTS.some((h) => hostname.includes(h));
  } catch {
    return false;
  }
}

function proxyUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (needsProxy(url)) {
    return `/api/media?url=${encodeURIComponent(url)}`;
  }
  return url;
}

interface Performer {
  username: string;
  recording_count?: number;
  latest_thumbnail?: string | null;
  sprite_url?: string | null;
  gender?: string | null;
  latest_timestamp?: string | null;
}

interface PerformerCardProps {
  performer?: Performer;
  performers?: Performer[];
  fetchPriority?: "high" | "low" | "auto";
  variant?: "square" | "circle";
}

function formatCount(n: number): string {
  if (n >= 1_000_000) {
    const m = (n / 1_000_000).toFixed(1);
    return `${m}M`;
  }
  if (n >= 1_000) {
    const k = (n / 1_000).toFixed(1);
    return `${k}k`;
  }
  return String(n);
}

function GroupCards({ performers }: { performers: Performer[] }) {
  return (
    <div className="flex items-center justify-center [&_svg]:size-full 
      [&:nth-child(1)]:[&_figure]:order-3 
      [&:nth-child(2)]:[&_figure]:order-2 
      [&:nth-child(3)]:[&_figure]:order-4 
      [&:nth-child(4)]:[&_figure]:order-1 
      [&:nth-child(5)]:[&_figure]:order-5 
      [&_figure]:[box-shadow:#0000001f_0_1px_3px,#0000003d_0_0_1px] 
      [&_figure]:[transition:all_.25s_ease] 
      hover:[&_figure]:z-[50] 
      hover:[&_figure]:size-16 
      [&:hover_figure:not(:hover)]:size-[38px]">
      {performers.map((p) => (
        <Link key={p.username} href={`/performers/${p.username}`} className="relative group w-full h-full">
          <figure className="flex items-center justify-center text-2xl font-extrabold leading-none text-zinc-400 p-4 bg-white relative rounded-full object-cover border border-solid border-zinc-300 
            [&:where(:nth-child(4),_:nth-child(5))]:size-8 
            [&:where(:nth-child(4),_:nth-child(5))]:z-[3] 
            [&:where(:nth-child(2),_:nth-child(3))]:size-11 
            [&:where(:nth-child(2),_:nth-child(3))]:z-[4] 
            [&:nth-child(1)]:size-16 
            [&:nth-child(1)]:z-[6] 
            [&:where(:not(:nth-child(4)))]:-ml-2 
            cursor-pointer
            transition-all duration-300
            group-hover:z-10
            group-hover:scale-110
            group-hover:shadow-lg">
            {p.username.charAt(0).toUpperCase()}
          </figure>
        </Link>
      ))}
    </div>
  );
}

function CircleCard({ performer, fetchPriority }: { performer: Performer; fetchPriority: "high" | "low" | "auto" }) {
  const initial = performer.username.charAt(0).toUpperCase();
  return (
    <Link href={`/performers/${performer.username}`} className="group block outline-none">
      <div className="flex flex-col items-center gap-2.5">
        <div className="relative w-[72px] h-[72px] sm:w-[82px] sm:h-[82px]">
          <div className="w-full h-full rounded-full overflow-hidden ring-2 ring-border/40 group-hover:ring-primary/50 transition-all duration-300 shadow-sm group-hover:shadow-md group-hover:shadow-primary/10">
            {performer.latest_thumbnail ? (
              <OptimizedImage
                src={performer.latest_thumbnail}
                alt={performer.username}
                fetchPriority={fetchPriority}
                loading={fetchPriority === "high" ? "eager" : "lazy"}
                className="w-full h-full object-cover object-top transition-transform duration-500 group-hover:scale-110 will-change-transform"
                containerClassName="w-full h-full"
              />
            ) : (
              <div className="w-full h-full bg-secondary flex items-center justify-center">
                <span className="text-lg font-black text-muted-foreground/30">{initial}</span>
              </div>
            )}
          </div>
          <div className="absolute -inset-1 rounded-full bg-primary/0 group-hover:bg-primary/5 -z-10 blur-sm transition-all duration-300" />
        </div>
        <div className="text-center min-w-0 max-w-[90px]">
          <p className="text-xs font-semibold text-foreground truncate group-hover:text-primary transition-colors">
            {performer.username}
          </p>
          <p className="text-[10px] text-muted-foreground/50 mt-0.5">
            {performer.recording_count ?? 0}
          </p>
        </div>
      </div>
    </Link>
  );
}

export const PerformerCard = memo(function PerformerCard({ performer, performers, fetchPriority = "low", variant = "square" }: PerformerCardProps) {
  if (performers && performers.length > 0) {
    return <GroupCards performers={performers} />;
  }

  if (!performer) return null;

  if (variant === "circle") {
    return <CircleCard performer={performer} fetchPriority={fetchPriority} />;
  }

  return <SquareCard performer={performer} fetchPriority={fetchPriority} />;
});

const SquareCard = memo(function SquareCard({ performer, fetchPriority }: { performer: Performer; fetchPriority: "high" | "low" | "auto" }) {
  const [isHovered, setIsHovered] = useState(false);

  const spriteUrl = useMemo(() => proxyUrl(performer.sprite_url), [performer.sprite_url]);
  const hasSprite = !!spriteUrl;

  const handleMouseEnter = useCallback(() => { setIsHovered(true); }, []);
  const handleMouseLeave = useCallback(() => { setIsHovered(false); }, []);

  const hasThumbnail = !!performer.latest_thumbnail;
  const initial = useMemo(() => performer.username.charAt(0).toUpperCase(), [performer.username]);
  const recCount = performer.recording_count ?? 0;

  return (
    <Link href={`/performers/${performer.username}`} className="group block outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-lg">
      <div
        className="relative overflow-hidden rounded-lg bg-card will-change-transform
          transition-all duration-400 ease-out
          group-hover:-translate-y-[2px]
          group-hover:shadow-[0_12px_32px_-8px_hsl(var(--primary)/0.15)]
          group-hover:shadow-black/40"
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        <div className="relative aspect-[3/4] overflow-hidden">
          {hasThumbnail ? (
            <OptimizedImage
              src={performer.latest_thumbnail!}
              alt={performer.username}
              fetchPriority={fetchPriority}
              loading={fetchPriority === "high" ? "eager" : "lazy"}
              className={[
                "object-cover object-top transition-all duration-600 ease-out will-change-transform",
                isHovered ? "scale-105" : "scale-100",
              ].join(" ")}
              containerClassName="absolute inset-0 w-full h-full"
              fallback={<div className="absolute inset-0 bg-secondary/60" />}
              noShimmer
            />
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-gradient-to-b from-secondary/50 to-secondary/80">
              <div className="w-12 h-12 rounded-full bg-primary/8 flex items-center justify-center mb-3">
                <Users className="w-5 h-5 text-primary/30" />
              </div>
              <span className="text-sm font-bold text-muted-foreground/25 uppercase tracking-[0.15em]">
                {initial}
              </span>
            </div>
          )}

          {hasSprite && isHovered && (
            <div className="absolute inset-0 transition-all duration-400 ease-out will-change-transform opacity-100 scale-100">
              <SpriteSlideshow
                spriteUrl={spriteUrl}
                fps={8}
                className="absolute inset-0 w-full h-full"
                active
              />
            </div>
          )}

          <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/85 via-black/40 to-transparent pt-14 pb-3 px-3">
            <p className="text-[13px] font-bold text-white leading-tight drop-shadow-[0_1px_4px_rgba(0,0,0,0.6)] truncate">
              {performer.username}
            </p>
            <div className="flex items-center gap-1.5 mt-[3px]">
              <span className="text-[10px] font-medium text-white/60 tabular-nums tracking-[0.01em]">
                {recCount === 1 ? "1 recording" : `${formatCount(recCount)} recordings`}
              </span>
            </div>
          </div>

          {recCount > 0 && (
            <div className="absolute top-2 right-2">
              <span className="inline-flex items-center justify-center min-w-[20px] h-[20px] px-[6px] rounded-full
                bg-black/40 backdrop-blur-sm ring-1 ring-white/12
                text-[9px] font-bold text-white/80 tabular-nums">
                {formatCount(recCount)}
              </span>
            </div>
          )}

          <div
            className={[
              "absolute inset-0 rounded-lg transition-all duration-400 pointer-events-none",
              isHovered
                ? "ring-1 ring-primary/50 shadow-[inset_0_0_30px_rgba(0,0,0,0.2)]"
                : "ring-0",
            ].join(" ")}
          />
        </div>
      </div>
    </Link>
  );
});
