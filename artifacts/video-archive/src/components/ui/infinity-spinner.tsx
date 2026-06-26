import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";

function InfinitySpinner({ className }: { className?: string }) {
  return (
    <Loader2 className={cn("animate-spin text-primary", className)} />
  );
}

export { InfinitySpinner };
