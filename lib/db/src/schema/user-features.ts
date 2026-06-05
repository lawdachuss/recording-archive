import { pgTable, serial, text, boolean, timestamp, unique } from "drizzle-orm/pg-core";

export const userProfilesTable = pgTable("user_profiles", {
  user_id: text("user_id").primaryKey(),
  display_name: text("display_name"),
  avatar_url: text("avatar_url"),
  bio: text("bio"),
  created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const userRolesTable = pgTable("user_roles", {
  user_id: text("user_id").primaryKey(),
  role: text("role").notNull().default("user"),
  created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const savedVideosTable = pgTable(
  "saved_videos",
  {
    id: serial("id").primaryKey(),
    user_id: text("user_id").notNull(),
    recording_id: text("recording_id").notNull(),
    metadata: text("metadata"),
    saved_at: timestamp("saved_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [unique("saved_videos_uniq").on(t.user_id, t.recording_id)],
);

export const watchHistoryTable = pgTable(
  "watch_history",
  {
    id: serial("id").primaryKey(),
    user_id: text("user_id").notNull(),
    recording_id: text("recording_id").notNull(),
    metadata: text("metadata"),
    watched_at: timestamp("watched_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [unique("watch_history_uniq").on(t.user_id, t.recording_id)],
);

export const watchLaterTable = pgTable(
  "watch_later_items",
  {
    id: serial("id").primaryKey(),
    user_id: text("user_id").notNull(),
    recording_id: text("recording_id").notNull(),
    metadata: text("metadata"),
    added_at: timestamp("added_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [unique("watch_later_uniq").on(t.user_id, t.recording_id)],
);

export const userCollectionsTable = pgTable("user_collections", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  user_id: text("user_id").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const userCollectionItemsTable = pgTable(
  "user_collection_items",
  {
    id: serial("id").primaryKey(),
    collection_id: text("collection_id").notNull(),
    recording_id: text("recording_id").notNull(),
    metadata: text("metadata"),
    added_at: timestamp("added_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [unique("collection_items_uniq").on(t.collection_id, t.recording_id)],
);

export const performerFollowsTable = pgTable(
  "performer_follows",
  {
    id: serial("id").primaryKey(),
    user_id: text("user_id").notNull(),
    performer_username: text("performer_username").notNull(),
    followed_at: timestamp("followed_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [unique("performer_follows_uniq").on(t.user_id, t.performer_username)],
);

export const userNotificationsTable = pgTable("user_notifications", {
  id: serial("id").primaryKey(),
  user_id: text("user_id").notNull(),
  type: text("type").notNull(),
  message: text("message").notNull(),
  related_id: text("related_id"),
  is_read: boolean("is_read").default(false).notNull(),
  created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
