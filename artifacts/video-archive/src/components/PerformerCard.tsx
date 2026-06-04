import { Link } from "wouter";
import { Performer } from "@workspace/api-client-react";

export function PerformerCard({ performer }: { performer: Performer }) {
  return (
    <Link href={`/performers/${performer.username}`} className="group block outline-none">
      <div className="overflow-hidden">
        <div className="aspect-[3/4] relative overflow-hidden bg-secondary">
          {performer.latest_thumbnail ? (
            <img
              src={performer.latest_thumbnail}
              alt={performer.username}
              className="w-full h-full object-cover object-top transition-transform duration-500 group-hover:scale-[1.04]"
            />
          ) : (
            <div className="w-full h-full bg-secondary flex items-center justify-center">
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
              {performer.recording_count} videos
            </p>
          </div>
        </div>
      </div>
    </Link>
  );
}
