import { Router } from "express";
import { db, sql } from "@workspace/db";
import { invalidateOnSuccess } from "../middleware/cache";

interface ReactionCountRow {
  likes: number;
  dislikes: number;
}

interface ReactionRow {
  id: number;
  type: string;
}

async function getReactionCounts(recordingId: string) {
  const result = await db.execute(sql`
    SELECT
      COUNT(*) FILTER (WHERE type = 'like') AS likes,
      COUNT(*) FILTER (WHERE type = 'dislike') AS dislikes
    FROM reactions
    WHERE recording_id = ${recordingId}
  `);
  const row = result.rows[0] as unknown as ReactionCountRow | undefined;
  return { likes: Number(row?.likes ?? 0), dislikes: Number(row?.dislikes ?? 0) };
}

async function getUserReaction(recordingId: string, sessionId: string): Promise<string | null> {
  const result = await db.execute(sql`
    SELECT type FROM reactions
    WHERE recording_id = ${recordingId} AND session_id = ${sessionId}
  `);
  const row = result.rows[0] as unknown as ReactionRow | undefined;
  return row?.type ?? null;
}

const router = Router();

router.get("/reactions", async (req, res) => {
  try {
    const { recording_id, session_id } = req.query as Record<string, string>;
    if (!recording_id) {
      res.status(400).json({ error: "recording_id is required" });
      return;
    }

    const counts = await getReactionCounts(recording_id);
    const user_reaction = session_id ? await getUserReaction(recording_id, session_id) : null;

    res.json({ ...counts, user_reaction });
  } catch (err) {
    req.log?.error?.({ err, recording_id: req.query.recording_id }, "GET /reactions error");
    res.status(500).json({ error: "Failed to fetch reactions" });
  }
});

router.post("/reactions", invalidateOnSuccess(["stats"]), async (req, res) => {
  try {
    const { recording_id, type, session_id } = req.body as {
      recording_id: string;
      type: string;
      session_id: string;
    };

    if (!recording_id || !type || !session_id) {
      res.status(400).json({ error: "recording_id, type, and session_id are required" });
      return;
    }
    if (type !== "like" && type !== "dislike") {
      res.status(400).json({ error: "type must be 'like' or 'dislike'" });
      return;
    }

    const existing = await db.execute(sql`
      SELECT id, type FROM reactions
      WHERE recording_id = ${recording_id} AND session_id = ${session_id}
    `);
    const existingRow = existing.rows[0] as unknown as ReactionRow | undefined;

    if (existingRow) {
      if (existingRow.type === type) {
        await db.execute(sql`
          DELETE FROM reactions
          WHERE recording_id = ${recording_id} AND session_id = ${session_id}
        `);
      } else {
        await db.execute(sql`
          UPDATE reactions SET type = ${type}
          WHERE recording_id = ${recording_id} AND session_id = ${session_id}
        `);
      }
    } else {
      await db.execute(sql`
        INSERT INTO reactions (recording_id, session_id, type)
        VALUES (${recording_id}, ${session_id}, ${type})
      `);
    }

    const counts = await getReactionCounts(recording_id);
    const user_reaction = await getUserReaction(recording_id, session_id);

    res.json({ ...counts, user_reaction });
  } catch (err) {
    req.log?.error?.({ err, recording_id: req.body.recording_id }, "POST /reactions error");
    res.status(500).json({ error: "Failed to process reaction" });
  }
});

export default router;
