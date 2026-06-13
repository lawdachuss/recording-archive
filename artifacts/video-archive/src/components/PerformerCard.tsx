import { Link } from "wouter";
import { OptimizedImage } from "@/components/ui/optimized-image";

interface Performer {
  username: string;
  recording_count?: number;
  latest_thumbnail?: string | null;
  gender?: string | null;
  latest_timestamp?: string | null;
}

interface PerformerCardProps {
  /** Single performer (legacy grid usage) */
  performer?: Performer;
  /** Array of performers for group/collage layout */
  performers?: Performer[];
  fetchPriority?: "high" | "low" | "auto";
  /** Visual variant — "square" for grid cards (default), "circle" for avatar-style */
  variant?: "square" | "circle";
}

export function PerformerCard({ performer, performers, fetchPriority = "low", variant = "square" }: PerformerCardProps) {
  // ─── Group layout (collage) ──────────────────────────────────
  if (performers && performers.length > 0) {
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
          <Link 
            key={p.username} 
            href={`/performers/${p.username}`} 
            className="relative group w-full h-full">
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

  if (!performer) return null;

  // ─── Circle variant (homepage avatar grid) ─────────────────
  if (variant === "circle") {
    const initial = performer.username.charAt(0).toUpperCase();
    return (
      <Link href={`/performers/${performer.username}`} className="group block outline-none">
        <div className="flex flex-col items-center gap-2.5">
          {/* Circular avatar */}
          <div className="relative w-[72px] h-[72px] sm:w-[82px] sm:h-[82px]">
            <div className="w-full h-full rounded-full overflow-hidden ring-2 ring-border/40 group-hover:ring-primary/50 transition-all duration-300 shadow-sm group-hover:shadow-md group-hover:shadow-primary/10">
              {performer.latest_thumbnail ? (
                <OptimizedImage
                  src={performer.latest_thumbnail}
                  alt={performer.username}
                  fetchPriority={fetchPriority}
                  loading={fetchPriority === "high" ? "eager" : "lazy"}
                  className="w-full h-full object-cover object-top transition-transform duration-500 group-hover:scale-110"
                  containerClassName="w-full h-full"
                />
              ) : (
                <div className="w-full h-full bg-secondary flex items-center justify-center">
                  <span className="text-lg font-black text-muted-foreground/30">
                    {initial}
                  </span>
                </div>
              )}
            </div>
            {/* Hover ring glow */}
            <div className="absolute -inset-1 rounded-full bg-primary/0 group-hover:bg-primary/5 -z-10 blur-sm transition-all duration-300" />
          </div>

          {/* Label */}
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

  // ─── Square variant (performers list page) ─────────────────
  return (
    <Link href={`/performers/${performer.username}`} className="group block outline-none">
      <div className="overflow-hidden">
        <div className="aspect-square relative overflow-hidden bg-secondary rounded-sm">
          {performer.latest_thumbnail ? (
            <OptimizedImage
              src={performer.latest_thumbnail}
              alt={performer.username}
              fetchPriority={fetchPriority}
              loading={fetchPriority === "high" ? "eager" : "lazy"}
              className="object-cover object-top transition-transform duration-500 group-hover:scale-[1.04]"
              containerClassName="absolute inset-0 w-full h-full"
              fallback={
                <div className="absolute inset-0 bg-secondary flex items-center justify-center">
                  <span className="text-2xl font-black text-muted-foreground/20 uppercase tracking-widest">
                    {performer.username.slice(0, 2)}
                  </span>
                </div>
              }
            />
          ) : (
            <div className="absolute inset-0 bg-secondary flex items-center justify-center">
              <span className="text-2xl font-black text-muted-foreground/20 uppercase tracking-widest">
                {performer.username.slice(0, 2)}
              </span>
            </div>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-80" />
          <div className="absolute bottom-0 left-0 right-0 p-3">
            <p className="text-sm font-semibold text-white leading-none truncate group-hover:text-primary transition-colors">
              {performer.username}
            </p>
            <p className="text-[11px] text-white/50 mt-1">
              {performer.recording_count ?? 0} videos
            </p>
          </div>
        </div>
      </div>
    </Link>
  );
}