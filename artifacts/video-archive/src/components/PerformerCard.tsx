import { Link } from "wouter";
import { Users, Film } from "lucide-react";
import { Performer } from "@workspace/api-client-react";
import { formatRelativeTime } from "@/lib/formatters";

export function PerformerCard({ performer }: { performer: Performer }) {
  return (
    <Link href={`/performers/${performer.username}`} className="group block">
      <div className="relative rounded-2xl overflow-hidden bg-card border border-border/50 transition-all duration-300 hover:border-primary/50 hover:shadow-xl hover:shadow-primary/10">
        <div className="aspect-square relative overflow-hidden bg-muted">
          {performer.latest_thumbnail ? (
            <img 
              src={performer.latest_thumbnail} 
              alt={performer.username}
              className="w-full h-full object-cover object-top group-hover:scale-105 transition-transform duration-700"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-secondary">
              <Users className="w-12 h-12 text-muted-foreground/30" />
            </div>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent" />
          
          <div className="absolute bottom-0 left-0 right-0 p-4">
            <h3 className="text-xl font-bold text-white mb-1 group-hover:text-primary transition-colors">
              {performer.username}
            </h3>
            <div className="flex items-center gap-3 text-xs text-white/70">
              <span className="flex items-center gap-1">
                <Film className="w-3.5 h-3.5" />
                {performer.recording_count} videos
              </span>
              {performer.latest_timestamp && (
                <>
                  <span className="w-1 h-1 rounded-full bg-white/30" />
                  <span>Last active {formatRelativeTime(performer.latest_timestamp)}</span>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </Link>
  );
}
