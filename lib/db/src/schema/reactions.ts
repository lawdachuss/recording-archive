import { pgTable, serial, text, timestamp, unique } from "drizzle-orm/pg-core";

export const reactionsTable = pgTable(
  "reactions",
  {
    id: serial("id").primaryKey(),
    recording_id: text("recording_id").notNull(),
    session_id: text("session_id").notNull(),
    type: text("type").notNull(),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [unique("reactions_recording_session_uniq").on(t.recording_id, t.session_id)],
);
