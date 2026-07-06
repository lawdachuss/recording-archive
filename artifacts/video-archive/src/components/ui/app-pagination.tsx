import { useState, type FormEvent } from "react";
import { ChevronLeft, ChevronRight, MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";

interface AppPaginationProps {
  itemsCount: number;
  itemsPerPage: number;
  currentPage: number;
  onPageChange: (page: number) => void;
  pageRangeDisplayed?: number;
  marginPagesDisplayed?: number;
  className?: string;
}

export function AppPagination({
  itemsCount,
  itemsPerPage,
  currentPage,
  onPageChange,
  pageRangeDisplayed = 5,
  marginPagesDisplayed = 2,
  className,
}: AppPaginationProps) {
  const totalPages = Math.ceil(itemsCount / itemsPerPage);
  const [jumpPage, setJumpPage] = useState("");
  if (totalPages <= 1) return null;

  const goToPage = (page: number) => {
    const clampedPage = Math.min(Math.max(1, page), totalPages);
    if (clampedPage !== currentPage) onPageChange(clampedPage);
  };

  const submitJump = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const page = Number(jumpPage);
    if (Number.isFinite(page)) {
      goToPage(Math.trunc(page));
      setJumpPage("");
    }
  };

  const buildPages = (): (number | "ellipsis")[] => {
    const visible = new Set<number>();

    visible.add(1);
    visible.add(totalPages);

    // Margin pages at both ends
    for (let i = 2; i <= Math.min(marginPagesDisplayed + 1, totalPages - 1); i++) {
      visible.add(i);
    }
    for (let i = Math.max(2, totalPages - marginPagesDisplayed); i < totalPages; i++) {
      visible.add(i);
    }

    // Sliding window around current page
    const half = Math.floor(pageRangeDisplayed / 2);
    let rangeStart = Math.max(2, currentPage - half);
    let rangeEnd = Math.min(totalPages - 1, rangeStart + pageRangeDisplayed - 1);
    if (rangeEnd - rangeStart + 1 < pageRangeDisplayed) {
      if (rangeStart === 2) rangeEnd = Math.min(totalPages - 1, pageRangeDisplayed);
      else rangeStart = Math.max(2, totalPages - pageRangeDisplayed);
    }

    for (let i = rangeStart; i <= rangeEnd; i++) {
      visible.add(i);
    }

    const sorted = [...visible].sort((a, b) => a - b);
    const result: (number | "ellipsis")[] = [];

    for (let i = 0; i < sorted.length; i++) {
      if (i > 0 && sorted[i] - sorted[i - 1] > 1) {
        result.push("ellipsis");
      }
      result.push(sorted[i]);
    }

    return result;
  };

  const pages = buildPages();
  const btnBase =
    "inline-flex items-center justify-center h-8 min-w-8 px-2 text-xs rounded border transition-colors select-none dark:bg-background";

  return (
    <nav
      role="navigation"
      aria-label="Pagination"
      className={cn("flex items-center gap-1", className)}
    >
      <button
        onClick={() => goToPage(currentPage - 1)}
        disabled={currentPage === 1}
        className={cn(
          btnBase,
          "gap-1 px-2.5 border-border/60 text-muted-foreground hover:border-border hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed",
        )}
        aria-label="Previous page"
      >
        <ChevronLeft className="w-3.5 h-3.5" />
        <span className="hidden sm:inline">Prev</span>
      </button>

      {pages.map((p, i) =>
        p === "ellipsis" ? (
          <span key={`ellipsis-${i}`} className="flex items-center justify-center w-8 h-8 text-muted-foreground/40">
            <MoreHorizontal className="w-3.5 h-3.5" />
          </span>
        ) : (
          <button
            key={p}
            onClick={() => goToPage(p)}
            aria-current={p === currentPage ? "page" : undefined}
            className={cn(
              btnBase,
              p === currentPage
                ? "border-primary/60 bg-primary/10 text-primary font-semibold"
                : "border-border/60 text-muted-foreground hover:border-border hover:text-foreground",
            )}
          >
            {p}
          </button>
        ),
      )}

      <button
        onClick={() => goToPage(currentPage + 1)}
        disabled={currentPage === totalPages}
        className={cn(
          btnBase,
          "gap-1 px-2.5 border-border/60 text-muted-foreground hover:border-border hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed",
        )}
        aria-label="Next page"
      >
        <span className="hidden sm:inline">Next</span>
        <ChevronRight className="w-3.5 h-3.5" />
      </button>

      {totalPages > 25 && (
        <form onSubmit={submitJump} className="ml-2 hidden sm:flex items-center gap-1">
          <input
            type="number"
            min={1}
            max={totalPages}
            value={jumpPage}
            onChange={(event) => setJumpPage(event.target.value)}
            placeholder="Page"
            aria-label="Jump to page"
            className="h-8 w-20 rounded border border-border/60 bg-background px-2 text-xs text-foreground outline-none focus:border-primary/60"
          />
          <button
            type="submit"
            className={cn(btnBase, "border-border/60 text-muted-foreground hover:border-border hover:text-foreground")}
          >
            Go
          </button>
        </form>
      )}
    </nav>
  );
}
