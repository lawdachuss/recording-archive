import { useState, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListComments,
  useCreateComment,
  useCreateReply,
  useToggleCommentLike,
  getListCommentsQueryKey,
} from "@workspace/api-client-react";
import type { Comment, ListCommentsSort } from "@workspace/api-client-react";
import { getSessionId } from "@/lib/session";
import { formatRelativeTime } from "@/lib/formatters";
import { MessageSquare, ThumbsUp, Reply, ChevronDown, ChevronUp, Loader2, Send } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

const SORT_OPTIONS: { value: ListCommentsSort; label: string }[] = [
  { value: "new", label: "Newest" },
  { value: "top", label: "Top" },
  { value: "old", label: "Oldest" },
];

interface CommentFormProps {
  placeholder?: string;
  onSubmit: (author: string, content: string) => Promise<void>;
  compact?: boolean;
  onCancel?: () => void;
}

function CommentForm({ placeholder = "Write a comment…", onSubmit, compact = false, onCancel }: CommentFormProps) {
  const [author, setAuthor] = useState("");
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim()) return;
    setLoading(true);
    try {
      await onSubmit(author.trim() || "Anonymous", content.trim());
      setContent("");
      if (compact) setAuthor("");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-2">
      {!compact && (
        <input
          type="text"
          placeholder="Your name (optional)"
          value={author}
          onChange={(e) => setAuthor(e.target.value)}
          maxLength={100}
          className="w-full h-8 bg-secondary/40 border border-border/50 focus:border-primary/50 rounded-[2px] px-3 text-xs outline-none transition-all placeholder:text-muted-foreground/40"
        />
      )}
      <div className="flex gap-2">
        <textarea
          placeholder={placeholder}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          maxLength={5000}
          rows={compact ? 2 : 3}
          className="flex-1 bg-secondary/40 border border-border/50 focus:border-primary/50 rounded-[2px] px-3 py-2 text-xs outline-none transition-all placeholder:text-muted-foreground/40 resize-none"
        />
      </div>
      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={loading || !content.trim()}
          className="inline-flex items-center gap-1.5 h-7 px-3 bg-primary text-white text-xs font-medium rounded-[2px] hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
          {compact ? "Reply" : "Post"}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="h-7 px-3 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

interface CommentNodeProps {
  comment: Comment;
  depth?: number;
  recordingId: string;
  sessionId: string;
  onLike: (id: number, liked: boolean) => void;
  onReplyPosted: () => void;
}

function CommentNode({ comment, depth = 0, recordingId, sessionId, onLike, onReplyPosted }: CommentNodeProps) {
  const [showReply, setShowReply] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [localLikes, setLocalLikes] = useState(comment.likes ?? 0);
  const [localLiked, setLocalLiked] = useState(comment.user_liked ?? false);

  const createReply = useCreateReply();

  const handleLike = () => {
    const newLiked = !localLiked;
    setLocalLiked(newLiked);
    setLocalLikes((n: number) => n + (newLiked ? 1 : -1));
    onLike(comment.id, newLiked);
  };

  const handleReplySubmit = async (author: string, content: string) => {
    await createReply.mutateAsync({
      commentId: comment.id,
      data: { author, content, session_id: sessionId },
    });
    setShowReply(false);
    onReplyPosted();
  };

  const hasReplies = (comment.replies?.length ?? 0) > 0;
  const initials = (comment.author || "A").slice(0, 2).toUpperCase();

  return (
    <div className={`${depth > 0 ? "ml-4 pl-4 border-l border-border/30" : ""}`}>
      <div className="py-3 group">
        <div className="flex items-start gap-2.5">
          <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5 text-[9px] font-bold text-primary/70 uppercase">
            {initials}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-semibold text-foreground/80">{comment.author}</span>
              <span className="text-[10px] text-muted-foreground/40">
                {formatRelativeTime(comment.created_at)}
              </span>
            </div>
            <p className={`text-xs leading-relaxed ${comment.deleted ? "text-muted-foreground/40 italic" : "text-foreground/70"}`}>
              {comment.content}
            </p>
            {!comment.deleted && (
              <div className="flex items-center gap-3 mt-2">
                <button
                  onClick={handleLike}
                  className={`flex items-center gap-1 text-[10px] transition-colors ${localLiked ? "text-primary" : "text-muted-foreground/50 hover:text-foreground/60"}`}
                >
                  <ThumbsUp className="w-3 h-3" />
                  {localLikes > 0 && <span>{localLikes}</span>}
                </button>
                {depth === 0 && (
                  <button
                    onClick={() => setShowReply((v) => !v)}
                    className="flex items-center gap-1 text-[10px] text-muted-foreground/50 hover:text-foreground/60 transition-colors"
                  >
                    <Reply className="w-3 h-3" />
                    Reply
                  </button>
                )}
                {hasReplies && (
                  <button
                    onClick={() => setCollapsed((v) => !v)}
                    className="flex items-center gap-1 text-[10px] text-muted-foreground/40 hover:text-muted-foreground/60 transition-colors"
                  >
                    {collapsed ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />}
                    {collapsed
                      ? `${comment.replies?.length} repl${comment.replies?.length === 1 ? "y" : "ies"}`
                      : "hide"}
                  </button>
                )}
              </div>
            )}
            {showReply && (
              <div className="mt-3">
                <CommentForm
                  placeholder={`Reply to ${comment.author}…`}
                  onSubmit={handleReplySubmit}
                  compact
                  onCancel={() => setShowReply(false)}
                />
              </div>
            )}
          </div>
        </div>
      </div>

      {!collapsed && hasReplies && (
        <div>
          {comment.replies!.map((reply: Comment) => (
            <CommentNode
              key={reply.id}
              comment={reply}
              depth={depth + 1}
              recordingId={recordingId}
              sessionId={sessionId}
              onLike={onLike}
              onReplyPosted={onReplyPosted}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface CommentSectionProps {
  recordingId: string;
}

export function CommentSection({ recordingId }: CommentSectionProps) {
  const sessionId = getSessionId();
  const [sort, setSort] = useState<ListCommentsSort>("new");
  const queryClient = useQueryClient();

  const { data: comments, isLoading } = useListComments(
    { recording_id: recordingId, sort, session_id: sessionId },
    { query: { enabled: !!recordingId, queryKey: getListCommentsQueryKey({ recording_id: recordingId, sort, session_id: sessionId }) } },
  );

  const createComment = useCreateComment();
  const toggleCommentLike = useToggleCommentLike();

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({
      queryKey: getListCommentsQueryKey({ recording_id: recordingId, sort, session_id: sessionId }),
    });
  }, [queryClient, recordingId, sort, sessionId]);

  const handleLike = (commentId: number, _liked: boolean) => {
    toggleCommentLike.mutate({
      commentId,
      data: { session_id: sessionId },
    });
  };

  const handlePost = async (author: string, content: string) => {
    await createComment.mutateAsync({
      data: { recording_id: recordingId, author, content, session_id: sessionId },
    });
    invalidate();
  };

  const count = comments?.reduce((n: number, c: Comment) => n + 1 + (c.replies?.length ?? 0), 0) ?? 0;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <MessageSquare className="w-4 h-4 text-primary/60" />
          Comments
          {count > 0 && (
            <span className="text-xs text-muted-foreground/50 font-normal">{count}</span>
          )}
        </h3>
        <div className="flex items-center gap-1">
          {SORT_OPTIONS.map((o) => (
            <button
              key={o.value}
              onClick={() => setSort(o.value)}
              className={`px-2.5 py-1 text-[10px] rounded-[2px] transition-colors ${
                sort === o.value
                  ? "bg-primary/10 text-primary font-medium"
                  : "text-muted-foreground/50 hover:text-foreground/60"
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      <CommentForm onSubmit={handlePost} />

      <div className="space-y-0 divide-y divide-border/20">
        {isLoading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="py-3 flex gap-2.5">
              <Skeleton className="w-6 h-6 rounded-full shrink-0" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-2/3" />
              </div>
            </div>
          ))
        ) : comments && comments.length > 0 ? (
          comments.map((comment: Comment) => (
            <CommentNode
              key={comment.id}
              comment={comment}
              recordingId={recordingId}
              sessionId={sessionId}
              onLike={handleLike}
              onReplyPosted={invalidate}
            />
          ))
        ) : (
          <p className="py-8 text-xs text-muted-foreground/40 text-center">
            No comments yet. Be the first!
          </p>
        )}
      </div>
    </div>
  );
}
