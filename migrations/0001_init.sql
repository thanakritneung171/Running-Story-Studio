-- Running Story Studio — initial schema.
-- owner_id = hex SHA-256 of the client's secret device key (see worker/auth.ts).
-- Large payloads (GPS tracks, media, exports) live in R2; D1 only holds metadata + design JSON.

CREATE TABLE IF NOT EXISTS activities (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  name TEXT NOT NULL,
  summary_json TEXT NOT NULL,          -- small derived summary (distance, time, ...)
  track_key TEXT,                      -- R2 key of the full normalized activity JSON
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_activities_owner ON activities(owner_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  name TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  design_json TEXT NOT NULL,
  template_id TEXT,
  activity_id TEXT REFERENCES activities(id) ON DELETE SET NULL,
  asset_ids_json TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_projects_owner ON projects(owner_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS templates (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  name TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  design_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_templates_owner ON templates(owner_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS media (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('image', 'video', 'export')),
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  name TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_media_owner ON media(owner_id, created_at DESC);
