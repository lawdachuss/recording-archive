import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { QUERY_PRESETS } from "./query-client";
import { supabase } from "./supabase";

export interface Recording {
  id: string;
  channel_id?: string | null;
  username: string;
  filename: string;
  timestamp: string;
  room_title?: string | null;
  tags?: string[];
  viewers?: number | null;
  resolution?: string | null;
  framerate?: number | null;
  filesize?: number | null;
  gender?: string | null;
  thumbnail_url?: string | null;
  embed_url?: string | null;
  preview_url?: string | null;
  instance_id?: string | null;
  created_at: string;
  updated_at?: string | null;
  links?: Record<string, string> | null;
}

export interface Performer {
  username: string;
  recording_count: number;
  latest_thumbnail?: string | null;
  gender?: string | null;
  latest_timestamp?: string | null;
}

export interface PerformersResponse {
  performers: Performer[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface PerformerProfile {
  username: string;
  recording_count?: number;
  gender?: string | null;
  recordings: Recording[];
}

export interface TagCount {
  tag: string;
  count: number;
}

export interface SiteStats {
  total_recordings: number;
  total_performers: number;
  total_tags: number;
  total_size_bytes: number;
  newest_recording?: string | null;
}

export type ListRecordingsSort = "newest" | "oldest" | "largest" | "popular";

export interface ListRecordingsParams {
  page?: number;
  limit?: number;
  search?: string;
  tags?: string;
  gender?: string;
  resolution?: string;
  sort?: ListRecordingsSort;
}

export interface ListRecordingsResponse {
  data: Recording[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

import { resolveApiPath } from "./api-base";

const API_TIMEOUT_MS = 15_000;
const inflightGetRequests = new Map<string, Promise<unknown>>();

async function fetchApi<T>(path: string, options?: RequestInit): Promise<T> {
  const method = (options?.method ?? "GET").toUpperCase();
  const url = resolveApiPath(path);

  if (method === "GET" && !options?.signal) {
    const cacheKey = url.toString();
    const existing = inflightGetRequests.get(cacheKey);
    if (existing) return existing as Promise<T>;

    const promise = fetchApiUncached<T>(url, method, options).finally(() => {
      if (inflightGetRequests.get(cacheKey) === promise) {
        inflightGetRequests.delete(cacheKey);
      }
    });
    inflightGetRequests.set(cacheKey, promise);
    return promise;
  }

  return fetchApiUncached<T>(url, method, options);
}

async function fetchApiUncached<T>(
  url: RequestInfo | URL,
  method: string,
  options?: RequestInit,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

  try {
    const headers = new Headers(options?.headers);
    if (!headers.has("accept")) headers.set("accept", "application/json");
    if (method !== "GET" && method !== "HEAD" && !headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }

    const res = await fetch(url, {
      ...options,
      method,
      headers,
      signal: options?.signal ?? controller.signal,
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  } finally {
    clearTimeout(timer);
  }
}

export function useListRecommendations(
  params: { page?: number; limit?: number; exclude?: string } = {},
  queryOptions?: { enabled?: boolean; placeholderData?: unknown; staleTime?: number },
) {
  const searchParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== "") searchParams.set(key, value.toString());
  });

  return useQuery({
    queryKey: ["recommendations", searchParams.toString()],
    queryFn: async () => {
      const headers: Record<string, string> = {};
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.access_token) headers["Authorization"] = `Bearer ${session.access_token}`;
      return fetchApi<ListRecordingsResponse>(`/api/recordings/recommendations?${searchParams}`, {
        headers,
      });
    },
    enabled: queryOptions?.enabled ?? true,
    placeholderData: queryOptions?.placeholderData as ListRecordingsResponse | undefined,
    ...QUERY_PRESETS.page(),
  });
}

export function useListPerformers(
  params?: {
    page?: number;
    limit?: number;
    search?: string;
    gender?: string;
    sort?: "count" | "name";
  },
  queryOptions?: Partial<{ staleTime: number }>,
) {
  const searchParams = new URLSearchParams();
  if (params?.page) searchParams.set("page", params.page.toString());
  if (params?.limit) searchParams.set("limit", params.limit.toString());
  if (params?.search) searchParams.set("search", params.search);
  if (params?.gender) searchParams.set("gender", params.gender);
  if (params?.sort) searchParams.set("sort", params.sort);

  return useQuery({
    queryKey: ["performers", searchParams.toString()],
    queryFn: () => fetchApi<PerformersResponse>(`/api/performers?${searchParams}`),
    placeholderData: keepPreviousData,
    ...QUERY_PRESETS.page(3 * 60_000),
    staleTime: queryOptions?.staleTime,
  });
}

export function useGetPerformer(username: string) {
  return useQuery({
    queryKey: ["performer", username],
    queryFn: () => fetchApi<PerformerProfile>(`/api/performers/${username}`),
    enabled: !!username,
    ...QUERY_PRESETS.page(),
  });
}

export function useListRecordings(
  params: ListRecordingsParams = {},
  queryOptions?: { enabled?: boolean; placeholderData?: unknown; staleTime?: number },
) {
  const searchParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== "") searchParams.set(key, value.toString());
  });

  return useQuery({
    queryKey: ["recordings", searchParams.toString()],
    queryFn: () => fetchApi<ListRecordingsResponse>(`/api/recordings?${searchParams}`),
    enabled: queryOptions?.enabled ?? true,
    placeholderData: queryOptions?.placeholderData as ListRecordingsResponse | undefined,
    ...QUERY_PRESETS.page(),
  });
}

export function useListTags() {
  return useQuery({
    queryKey: ["tags"],
    queryFn: () => fetchApi<TagCount[]>(`/api/tags`),
    ...QUERY_PRESETS.page(),
  });
}

export function useGetStats() {
  return useQuery({
    queryKey: ["stats"],
    queryFn: () => fetchApi<SiteStats>(`/api/stats`),
    ...QUERY_PRESETS.stats(),
  });
}

// ─── Search Suggestions ──────────────────────────────────────────

export interface SearchSuggestion {
  type: "performer" | "recording" | "tag";
  label: string;
  subtitle?: string;
  image_url?: string | null;
  href: string;
}

export interface SearchSuggestionsResponse {
  suggestions: SearchSuggestion[];
  query: string;
}

/**
 * Fetch search suggestions as the user types.
 * Debounce is handled by the caller (typically ~250ms).
 */
export function useSearchSuggestions(query: string) {
  return useQuery({
    queryKey: ["search", "suggestions", query],
    queryFn: () => fetchApi<SearchSuggestionsResponse>(`/api/search?q=${encodeURIComponent(query)}`),
    enabled: query.trim().length >= 2,
    ...QUERY_PRESETS.search(),
  });
}

export interface PerformerLookupResult {
  exists: boolean;
  platform: string;
  username: string;
  display_name?: string;
  avatar_url?: string;
  is_online?: boolean;
  last_seen?: string;
  room_title?: string;
  viewer_count?: number;
  follower_count?: number;
  profile_url: string;
  in_archive: boolean;
  archive_thumbnail?: string | null;
  archive_recording_count?: number;
  archive_last_recording?: string | null;
  platform_check_failed?: boolean;
}

export function usePerformerLookup(platform: string, username: string) {
  return useQuery({
    queryKey: ["performer-lookup", platform, username],
    queryFn: () => {
      const params = new URLSearchParams({ platform, username });
      return fetchApi<PerformerLookupResult>(`/api/performers/lookup?${params}`);
    },
    enabled: !!platform && username.length >= 2,
    staleTime: 5 * 60_000,
    retry: false,
  });
}

export function useCreateRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: {
      platform: string;
      performer_username?: string;
      stream_link?: string;
      notes?: string;
      priority?: string;
    }) => {
      const { supabase } = await import("@/lib/supabase");
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      return fetchApi<{ id: string }>("/api/requests", {
        method: "POST",
        body: JSON.stringify(data),
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["requests"] });
    },
  });
}

export function getGetPerformerQueryKey(username: string) {
  return ["performer", username];
}

export function useGetRecording(id: string) {
  return useQuery({
    queryKey: ["recording", id],
    queryFn: () => fetchApi<Recording>(`/api/recordings/${id}`),
    enabled: !!id,
    ...QUERY_PRESETS.detail(),
  });
}

export function useListRelatedRecordings(id: string, limit = 8) {
  return useQuery({
    queryKey: ["recordings", "related", id, limit],
    queryFn: () => fetchApi<Recording[]>(`/api/recordings/related?id=${id}&limit=${limit}`),
    enabled: !!id,
    ...QUERY_PRESETS.page(),
  });
}

export function useGetReactions(id: string) {
  return useQuery({
    queryKey: ["reactions", id],
    queryFn: () => fetchApi<{ likes: number; dislikes: number; user_reaction?: string | null }>(`/api/recordings/${id}/reactions`),
    enabled: !!id,
    ...QUERY_PRESETS.search(), // reactions change fast
  });
}

export function useToggleReaction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, type }: { id: string; type: "like" | "dislike" }) =>
      fetchApi<{ likes: number; dislikes: number; user_reaction: string }>(`/api/recordings/${id}/reactions`, {
        method: "POST",
        body: JSON.stringify({ type }),
      }),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: ["reactions", id] });
      queryClient.invalidateQueries({ queryKey: ["recording", id] });
    },
  });
}

export function getGetRecordingQueryKey(id: string) {
  return ["recording", id];
}

export function getListRelatedRecordingsQueryKey(id: string, limit = 8) {
  return ["recordings", "related", id, limit];
}

export function getGetReactionsQueryKey(id: string) {
  return ["reactions", id];
}

export interface Comment {
  id: string;
  recording_id: string;
  user_id: string;
  parent_id: string | null;
  content: string;
  likes: number;
  dislikes: number;
  user_reaction: string | null;
  created_at: string;
  updated_at: string;
}

export type ListCommentsSort = "newest" | "oldest" | "top";

export interface ListCommentsParams {
  recording_id: string;
  page?: number;
  limit?: number;
  sort?: ListCommentsSort;
}

export function useListComments(params: ListCommentsParams) {
  const searchParams = new URLSearchParams();
  searchParams.set("recording_id", params.recording_id);
  if (params.page) searchParams.set("page", params.page.toString());
  if (params.limit) searchParams.set("limit", params.limit.toString());
  if (params.sort) searchParams.set("sort", params.sort);

  return useQuery<{ data: Comment[]; total: number; page: number; limit: number; totalPages: number }>({
    queryKey: ["comments", searchParams.toString()],
    queryFn: () => fetchApi<{ data: Comment[]; total: number; page: number; limit: number; totalPages: number }>(`/api/comments?${searchParams}`),
    ...QUERY_PRESETS.page(),
  });
}

export function useCreateComment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { recording_id: string; content: string; parent_id?: string }) =>
      fetchApi<Comment>("/api/comments", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ["comments", `recording_id=${vars.recording_id}`] });
    },
  });
}

export function useCreateReply() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { recording_id: string; parent_id: string; content: string }) =>
      fetchApi<Comment>("/api/comments", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ["comments", `recording_id=${vars.recording_id}`] });
    },
  });
}

export function useToggleCommentLike() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, type }: { id: string; type: "like" | "dislike" }) =>
      fetchApi<{ likes: number; dislikes: number; user_reaction: string }>(`/api/comments/${id}/reactions`, {
        method: "POST",
        body: JSON.stringify({ type }),
      }),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: ["comments", id] });
    },
  });
}

export function getListCommentsQueryKey(params: ListCommentsParams) {
  const searchParams = new URLSearchParams();
  searchParams.set("recording_id", params.recording_id);
  if (params.page) searchParams.set("page", params.page.toString());
  if (params.limit) searchParams.set("limit", params.limit.toString());
  if (params.sort) searchParams.set("sort", params.sort);
  return ["comments", searchParams.toString()];
}

// ─── View Counting ───────────────────────────────────────────

const VIEWED_SET_KEY = "vault_viewed_recordings";

/**
 * Track a view for a recording. Uses sessionStorage to ensure we only
 * count one view per video per browser session.
 *
 * Returns true if the view was tracked, false if already viewed this session.
 */
export async function trackView(recordingId: string): Promise<boolean> {
  // Check sessionStorage dedup
  try {
    const viewed = JSON.parse(sessionStorage.getItem(VIEWED_SET_KEY) || "[]") as string[];
    if (viewed.includes(recordingId)) {
      return false; // Already counted this session
    }

    // Send view event to API
    await fetchApi<{ viewers: number }>(`/api/recordings/${recordingId}/view`, {
      method: "POST",
    });

    // Mark as viewed
    viewed.push(recordingId);
    sessionStorage.setItem(VIEWED_SET_KEY, JSON.stringify(viewed));
    return true;
  } catch {
    // Silently fail — view tracking is non-critical
    return false;
  }
}
