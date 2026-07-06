-- Speeds up /api/recordings pagination, sorting, and common filters.
-- Run during a low-traffic window. CONCURRENTLY cannot run inside a transaction.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_recordings_valid_timestamp_desc
  ON recordings (timestamp DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_recordings_valid_timestamp_asc
  ON recordings (timestamp ASC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_recordings_valid_viewers_desc
  ON recordings (viewers DESC NULLS LAST);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_recordings_valid_filesize_desc
  ON recordings (filesize DESC NULLS LAST);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_recordings_valid_gender
  ON recordings (gender, timestamp DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_recordings_valid_resolution
  ON recordings (resolution, timestamp DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_recordings_valid_username
  ON recordings (username, timestamp DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_recordings_tags_gin
  ON recordings USING GIN (tags);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_upload_links_recording_host
  ON upload_links (recording_id, host);
