import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const requestsTable = pgTable("requests", {
  id: serial("id").primaryKey(),
  performer_username: text("performer_username"),
  stream_link: text("stream_link"),
  notes: text("notes"),
  priority: text("priority").default("normal"),
  status: text("status").default("pending").notNull(),
  created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const insertRequestSchema = createInsertSchema(requestsTable).omit({ id: true, created_at: true });
export type InsertRequest = z.infer<typeof insertRequestSchema>;
export type Request = typeof requestsTable.$inferSelect;
