import { supabase } from "./supabase";
import { resolveApiPath } from "./api-base";
import type { SavedRecording } from "./bookmarks";

async function authHeaders(): Promise<Record<string, string>> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) return {};
  return { Authorization: `Bearer ${session.access_token}` };
}

async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const headers = {
    ...(options.body ? { "Content-Type": "application/json" } : {}),
    ...(await authHeaders()),
    ...(options.headers as Record<string, string> | undefined),
  };
  const res = await fetch(resolveApiPath(path), { ...options, headers });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  if (res.status === 204) return undefined as T;
  return res.json();
}

export interface CloudItem {
  recording_id: string;
  metadata: string | null;
  saved_at?: string;
  watched_at?: string;
  added_at?: string;
}

export interface CloudCollection {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
  item_count?: number;
  first_item_metadata?: string | null;
}

export interface PerformerFollow {
  performer_username: string;
  followed_at: string;
}

export interface UserNotification {
  id: number;
  type: string;
  message: string;
  related_id: string | null;
  is_read: boolean;
  created_at: string;
}

export interface UserProfile {
  user_id: string;
  display_name: string | null;
  avatar_url: string | null;
  bio: string | null;
  created_at: string;
  updated_at: string;
}

export function parseCloudItem(item: CloudItem): SavedRecording {
  if (item.metadata) {
    try {
      const parsed = JSON.parse(item.metadata) as SavedRecording;
      return { ...parsed, id: item.recording_id };
    } catch {}
  }
  return {
    id: item.recording_id,
    username: "",
    filename: item.recording_id,
    room_title: undefined,
    thumbnail_url: undefined,
    resolution: undefined,
    timestamp: "",
    saved_at:
      item.saved_at ?? item.watched_at ?? item.added_at ?? new Date().toISOString(),
  };
}

export function recordingToMeta(rec: SavedRecording): string {
  return JSON.stringify(rec);
}

export const userApi = {
  getProfile: () => apiFetch<UserProfile>("/api/user/profile"),
  updateProfile: (data: Partial<UserProfile>) =>
    apiFetch<UserProfile>("/api/user/profile", {
      method: "PUT",
      body: JSON.stringify(data),
    }),

  getRole: () => apiFetch<{ role: string }>("/api/user/role"),

  getSaved: () => apiFetch<CloudItem[]>("/api/user/saved"),
  addSaved: (recording_id: string, metadata: string) =>
    apiFetch("/api/user/saved", {
      method: "POST",
      body: JSON.stringify({ recording_id, metadata }),
    }),
  removeSaved: (recording_id: string) =>
    apiFetch(`/api/user/saved/${encodeURIComponent(recording_id)}`, {
      method: "DELETE",
    }),

  getHistory: () => apiFetch<CloudItem[]>("/api/user/history"),
  addHistory: (recording_id: string, metadata: string) =>
    apiFetch("/api/user/history", {
      method: "POST",
      body: JSON.stringify({ recording_id, metadata }),
    }),
  clearHistory: () =>
    apiFetch("/api/user/history", { method: "DELETE" }),

  getWatchLater: () => apiFetch<CloudItem[]>("/api/user/watch-later"),
  addWatchLater: (recording_id: string, metadata: string) =>
    apiFetch("/api/user/watch-later", {
      method: "POST",
      body: JSON.stringify({ recording_id, metadata }),
    }),
  removeWatchLater: (recording_id: string) =>
    apiFetch(`/api/user/watch-later/${encodeURIComponent(recording_id)}`, {
      method: "DELETE",
    }),
  clearWatchLater: () =>
    apiFetch("/api/user/watch-later", { method: "DELETE" }),

  getCollections: () => apiFetch<CloudCollection[]>("/api/user/collections"),
  createCollection: (name: string, description?: string) =>
    apiFetch<CloudCollection>("/api/user/collections", {
      method: "POST",
      body: JSON.stringify({ name, description }),
    }),
  updateCollection: (id: string, name: string, description?: string) =>
    apiFetch<CloudCollection>(`/api/user/collections/${id}`, {
      method: "PUT",
      body: JSON.stringify({ name, description }),
    }),
  deleteCollection: (id: string) =>
    apiFetch(`/api/user/collections/${id}`, { method: "DELETE" }),
  getCollectionItems: (id: string) =>
    apiFetch<CloudItem[]>(`/api/user/collections/${id}/items`),
  addCollectionItem: (id: string, recording_id: string, metadata: string) =>
    apiFetch(`/api/user/collections/${id}/items`, {
      method: "POST",
      body: JSON.stringify({ recording_id, metadata }),
    }),
  removeCollectionItem: (id: string, recording_id: string) =>
    apiFetch(
      `/api/user/collections/${id}/items/${encodeURIComponent(recording_id)}`,
      { method: "DELETE" },
    ),

  getFollows: () => apiFetch<PerformerFollow[]>("/api/user/follows"),
  addFollow: (performer_username: string) =>
    apiFetch("/api/user/follows", {
      method: "POST",
      body: JSON.stringify({ performer_username }),
    }),
  removeFollow: (username: string) =>
    apiFetch(`/api/user/follows/${encodeURIComponent(username)}`, {
      method: "DELETE",
    }),

  getNotifications: () =>
    apiFetch<UserNotification[]>("/api/user/notifications"),
  markAllRead: () =>
    apiFetch("/api/user/notifications/read-all", { method: "PUT" }),
  deleteNotification: (id: number) =>
    apiFetch(`/api/user/notifications/${id}`, { method: "DELETE" }),
};
