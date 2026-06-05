import { pgTable, serial, text, boolean, integer, timestamp } from "drizzle-orm/pg-core";

export const commentsTable = pgTable("comments", {
  id: serial("id").primaryKey(),
  recording_id: text("recording_id").notNull(),
  parent_id: integer("parent_id"),
  author: text("author").notNull(),
  content: text("content").notNull(),
  deleted: boolean("deleted").default(false).notNull(),
  created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const commentLikesTable = pgTable("comment_likes", {
  id: serial("id").primaryKey(),
  comment_id: integer("comment_id").notNull(),
  session_id: text("session_id").notNull(),
  created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
