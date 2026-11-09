use rusqlite::{Connection, OptionalExtension};
use std::path::{Path, PathBuf};

use super::error::{DomainError, DomainResult};

pub const CURRENT_SCHEMA_VERSION: i32 = 25;
pub const BASE_TIMEZONE_OFFSET: &str = "+08:00";

const MIGRATION_V1: &str = r#"
CREATE TABLE IF NOT EXISTS archive_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS timezone_replacement (
  id TEXT PRIMARY KEY,
  start_utc TEXT NOT NULL,
  end_utc TEXT NOT NULL,
  offset TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS productivity_project (
  id TEXT PRIMARY KEY,
  revision INTEGER NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL,
  planned_point_json TEXT,
  due_point_json TEXT,
  deletion_batch_id TEXT,
  created_at_utc TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL,
  deleted_at_utc TEXT,
  extra_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS productivity_task (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  parent_task_id TEXT,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL,
  planned_point_json TEXT,
  due_point_json TEXT,
  deletion_batch_id TEXT,
  created_at_utc TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL,
  deleted_at_utc TEXT,
  extra_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS productivity_list (
  id TEXT PRIMARY KEY,
  revision INTEGER NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL,
  planned_point_json TEXT,
  due_point_json TEXT,
  deletion_batch_id TEXT,
  created_at_utc TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL,
  deleted_at_utc TEXT,
  extra_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS productivity_item (
  id TEXT PRIMARY KEY,
  revision INTEGER NOT NULL,
  list_id TEXT,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL,
  planned_point_json TEXT,
  due_point_json TEXT,
  deletion_batch_id TEXT,
  created_at_utc TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL,
  deleted_at_utc TEXT,
  extra_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS productivity_session (
  id TEXT PRIMARY KEY,
  revision INTEGER NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  planned_start_at TEXT NOT NULL,
  planned_end_at TEXT NOT NULL,
  deletion_batch_id TEXT,
  created_at_utc TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL,
  deleted_at_utc TEXT,
  extra_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS productivity_action (
  id TEXT PRIMARY KEY,
  revision INTEGER NOT NULL,
  title TEXT NOT NULL,
  summary TEXT,
  session_id TEXT,
  target_kind TEXT,
  target_id TEXT,
  planned_start_at TEXT,
  planned_end_at TEXT,
  planned_duration_seconds INTEGER,
  ended INTEGER NOT NULL DEFAULT 0,
  deletion_batch_id TEXT,
  created_at_utc TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL,
  deleted_at_utc TEXT,
  extra_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS productivity_interval (
  id TEXT PRIMARY KEY,
  action_id TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  deletion_batch_id TEXT,
  created_at_utc TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL,
  deleted_at_utc TEXT,
  extra_json TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_task_project ON productivity_task(project_id);
CREATE INDEX IF NOT EXISTS idx_task_parent ON productivity_task(parent_task_id);
CREATE INDEX IF NOT EXISTS idx_item_list ON productivity_item(list_id);
CREATE INDEX IF NOT EXISTS idx_action_session ON productivity_action(session_id);
CREATE INDEX IF NOT EXISTS idx_action_target ON productivity_action(target_kind, target_id);
CREATE INDEX IF NOT EXISTS idx_interval_action ON productivity_interval(action_id);
"#;

const MIGRATION_V2: &str = r#"
ALTER TABLE productivity_action ADD COLUMN appearance_json TEXT NOT NULL DEFAULT '{}';
"#;

const MIGRATION_V3: &str = r#"
ALTER TABLE productivity_session ADD COLUMN track_lane INTEGER NOT NULL DEFAULT 0;
ALTER TABLE productivity_session ADD COLUMN track_span INTEGER NOT NULL DEFAULT 1;
"#;

// Health Archive tables per docs/specs/orbita-health-archive.md
const MIGRATION_V4: &str = r#"
CREATE TABLE IF NOT EXISTS health_meal (
  id TEXT PRIMARY KEY,
  revision INTEGER NOT NULL,
  local_date TEXT NOT NULL,
  started_at_utc TEXT NOT NULL,
  ended_at_utc TEXT,
  slot TEXT,
  text TEXT,
  kcal REAL,
  carbs_grams REAL,
  protein_grams REAL,
  fat_grams REAL,
  source TEXT NOT NULL DEFAULT 'manual',
  at_hm TEXT,
  items_json TEXT NOT NULL DEFAULT '[]',
  created_at_utc TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL,
  deleted_at_utc TEXT,
  extra_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS health_day (
  id TEXT PRIMARY KEY,
  revision INTEGER NOT NULL,
  local_date TEXT NOT NULL UNIQUE,
  source TEXT NOT NULL DEFAULT 'garmin',
  data_json TEXT NOT NULL DEFAULT '{}',
  created_at_utc TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL,
  deleted_at_utc TEXT,
  extra_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS health_sample (
  id TEXT PRIMARY KEY,
  day_id TEXT NOT NULL,
  local_date TEXT NOT NULL,
  metric TEXT NOT NULL,
  series TEXT NOT NULL DEFAULT 'default',
  snapshot_json TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  parser_version INTEGER NOT NULL DEFAULT 1,
  created_at_utc TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL,
  deleted_at_utc TEXT,
  UNIQUE(local_date, metric, series)
);

CREATE TABLE IF NOT EXISTS health_sleep_night (
  id TEXT PRIMARY KEY,
  revision INTEGER NOT NULL,
  wake_local_date TEXT NOT NULL UNIQUE,
  source TEXT NOT NULL DEFAULT 'garmin',
  night_json TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  parser_version INTEGER NOT NULL DEFAULT 1,
  created_at_utc TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL,
  deleted_at_utc TEXT
);

CREATE TABLE IF NOT EXISTS health_nap (
  id TEXT PRIMARY KEY,
  revision INTEGER NOT NULL,
  wake_local_date TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'garmin',
  started_at_utc TEXT NOT NULL,
  ended_at_utc TEXT NOT NULL,
  text TEXT,
  nap_json TEXT NOT NULL DEFAULT '{}',
  created_at_utc TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL,
  deleted_at_utc TEXT
);

CREATE TABLE IF NOT EXISTS health_activity (
  id TEXT PRIMARY KEY,
  revision INTEGER NOT NULL,
  local_date TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'garmin',
  garmin_activity_id TEXT,
  activity_json TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  parser_version INTEGER NOT NULL DEFAULT 1,
  suspected_duplicate_of TEXT,
  created_at_utc TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL,
  deleted_at_utc TEXT
);

CREATE TABLE IF NOT EXISTS garmin_class_hash (
  class_id TEXT NOT NULL,
  local_date TEXT NOT NULL,
  external_id TEXT NOT NULL DEFAULT '',
  content_hash TEXT NOT NULL,
  parser_version INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (class_id, local_date, external_id)
);

CREATE TABLE IF NOT EXISTS garmin_sync_run (
  id TEXT PRIMARY KEY,
  started_at_utc TEXT NOT NULL,
  finished_at_utc TEXT,
  entry_point TEXT NOT NULL,
  requested_local_date_from TEXT NOT NULL,
  requested_local_date_to TEXT NOT NULL,
  overall_status TEXT NOT NULL,
  submitted_class_count INTEGER NOT NULL DEFAULT 0,
  skipped_same_hash_count INTEGER NOT NULL DEFAULT 0,
  retained_gap_count INTEGER NOT NULL DEFAULT 0,
  error_code TEXT,
  error_summary TEXT
);

CREATE TABLE IF NOT EXISTS garmin_sync_run_coverage (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  class_id TEXT NOT NULL,
  local_date TEXT NOT NULL,
  external_id TEXT,
  outcome TEXT NOT NULL,
  submitted_root_ids_json TEXT NOT NULL DEFAULT '[]',
  error_code TEXT,
  error_summary TEXT,
  FOREIGN KEY (run_id) REFERENCES garmin_sync_run(id)
);

CREATE TABLE IF NOT EXISTS health_sync_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_health_meal_local_date ON health_meal(local_date);
CREATE INDEX IF NOT EXISTS idx_health_day_local_date ON health_day(local_date);
CREATE INDEX IF NOT EXISTS idx_health_sample_day_metric ON health_sample(local_date, metric);
CREATE INDEX IF NOT EXISTS idx_health_nap_wake_date ON health_nap(wake_local_date);
CREATE INDEX IF NOT EXISTS idx_health_activity_local_date ON health_activity(local_date);
CREATE INDEX IF NOT EXISTS idx_health_activity_garmin_id ON health_activity(garmin_activity_id);
CREATE INDEX IF NOT EXISTS idx_garmin_sync_run_started ON garmin_sync_run(started_at_utc);
"#;

const MIGRATION_V5: &str = r#"
ALTER TABLE health_meal ADD COLUMN title TEXT;

CREATE TABLE IF NOT EXISTS health_meal_food (
  id TEXT PRIMARY KEY,
  meal_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  text TEXT NOT NULL,
  kcal REAL NOT NULL,
  kcal_estimated INTEGER NOT NULL,
  serving_text TEXT,
  serving_estimated INTEGER,
  carbs_grams REAL,
  protein_grams REAL,
  fat_grams REAL,
  sugar_grams REAL,
  fiber_grams REAL,
  sodium_mg REAL,
  vitamin_c_mg REAL,
  nutrients_estimated INTEGER,
  created_at_utc TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL,
  deleted_at_utc TEXT
);

CREATE INDEX IF NOT EXISTS idx_health_meal_food_meal_id ON health_meal_food(meal_id);
CREATE INDEX IF NOT EXISTS idx_health_meal_food_text ON health_meal_food(text);
"#;

// V6/V7：受管文件须先落盘再提交 SQLite 指针；失败不删旧文件。本迁移不是产品级备份功能。
// 见 docs/specs/journal-local-commands.proposed.md、docs/adr/0037-garmin-activity-local-detail-and-list.md
const MIGRATION_V6: &str = r#"
CREATE TABLE IF NOT EXISTS journal_entry (
  id TEXT PRIMARY KEY,
  revision INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('note','document')),
  title TEXT,
  started_at_utc TEXT NOT NULL,
  ended_at_utc TEXT,
  mood TEXT,
  text TEXT,
  summary TEXT,
  detail_file_id TEXT,
  detail_sha256 TEXT,
  created_at_utc TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL,
  deleted_at_utc TEXT,
  CHECK (kind <> 'document' OR (title IS NOT NULL AND length(trim(title)) > 0))
);
CREATE INDEX IF NOT EXISTS idx_journal_entry_started ON journal_entry(started_at_utc);

ALTER TABLE productivity_item ADD COLUMN priority TEXT NOT NULL DEFAULT 'none';
ALTER TABLE productivity_task ADD COLUMN sibling_position INTEGER NOT NULL DEFAULT 0;

UPDATE productivity_task
SET sibling_position = (
  SELECT COUNT(*)
  FROM productivity_task AS t2
  WHERE t2.project_id = productivity_task.project_id
    AND IFNULL(t2.parent_task_id, '') = IFNULL(productivity_task.parent_task_id, '')
    AND (
      t2.created_at_utc < productivity_task.created_at_utc
      OR (t2.created_at_utc = productivity_task.created_at_utc AND t2.id < productivity_task.id)
    )
);

CREATE TABLE IF NOT EXISTS productivity_item_order (
  id TEXT PRIMARY KEY,
  revision INTEGER NOT NULL,
  updated_at_utc TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS productivity_item_order_entry (
  item_id TEXT PRIMARY KEY,
  position INTEGER NOT NULL
);

INSERT INTO productivity_item_order (id, revision, updated_at_utc)
VALUES ('item-order', 1, '1970-01-01T00:00:00Z');

INSERT INTO productivity_item_order_entry (item_id, position)
SELECT id, (
  SELECT COUNT(*)
  FROM productivity_item AS i2
  WHERE i2.deleted_at_utc IS NULL
    AND (i2.created_at_utc < productivity_item.created_at_utc
     OR (i2.created_at_utc = productivity_item.created_at_utc AND i2.id < productivity_item.id))
)
FROM productivity_item
WHERE productivity_item.deleted_at_utc IS NULL;

CREATE TABLE IF NOT EXISTS workspace_container (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('root','group')),
  title TEXT,
  revision INTEGER NOT NULL,
  root_position INTEGER,
  created_at_utc TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL,
  deleted_at_utc TEXT,
  CHECK (kind <> 'group' OR (title IS NOT NULL AND length(trim(title)) > 0)),
  CHECK (kind <> 'root' OR title IS NULL)
);
CREATE TABLE IF NOT EXISTS workspace_member (
  id TEXT PRIMARY KEY,
  container_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  member_kind TEXT NOT NULL CHECK (member_kind IN ('project','list','journal_document','link')),
  domain TEXT,
  object_type TEXT,
  object_id TEXT,
  link_kind TEXT CHECK (link_kind IS NULL OR link_kind IN ('bookmark','executable','file','folder')),
  link_title TEXT,
  link_url TEXT,
  created_at_utc TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL,
  deleted_at_utc TEXT
);
CREATE TABLE IF NOT EXISTS workspace_device_binding (
  link_member_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  local_path TEXT NOT NULL,
  PRIMARY KEY (link_member_id, device_id)
);

INSERT INTO workspace_container (id, kind, revision, root_position, created_at_utc, updated_at_utc)
VALUES ('workspace-root', 'root', 1, NULL, '1970-01-01T00:00:00Z', '1970-01-01T00:00:00Z');
"#;

const MIGRATION_V7: &str = r#"
ALTER TABLE health_activity ADD COLUMN started_at_utc TEXT;
ALTER TABLE health_activity ADD COLUMN ended_at_utc TEXT;
ALTER TABLE health_activity ADD COLUMN type_key TEXT;
ALTER TABLE health_activity ADD COLUMN title TEXT;
ALTER TABLE health_activity ADD COLUMN duration_seconds REAL;
ALTER TABLE health_activity ADD COLUMN elapsed_duration_seconds REAL;
ALTER TABLE health_activity ADD COLUMN moving_duration_seconds REAL;
ALTER TABLE health_activity ADD COLUMN distance_meters REAL;
ALTER TABLE health_activity ADD COLUMN elevation_gain_meters REAL;
ALTER TABLE health_activity ADD COLUMN avg_heart_rate_bpm REAL;
ALTER TABLE health_activity ADD COLUMN avg_speed_mps REAL;
ALTER TABLE health_activity ADD COLUMN avg_pace_seconds_per_km REAL;
ALTER TABLE health_activity ADD COLUMN avg_power_watts REAL;
ALTER TABLE health_activity ADD COLUMN calories REAL;
ALTER TABLE health_activity ADD COLUMN detail_status TEXT;
CREATE TABLE IF NOT EXISTS health_activity_asset (
  id TEXT PRIMARY KEY,
  activity_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  relative_path TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  status TEXT NOT NULL,
  acquired_at_utc TEXT,
  UNIQUE (activity_id, kind)
);
CREATE INDEX IF NOT EXISTS idx_health_activity_started ON health_activity(started_at_utc);
"#;

const MIGRATION_V8: &str = r#"
ALTER TABLE health_activity ADD COLUMN max_heart_rate_bpm REAL;
ALTER TABLE health_activity ADD COLUMN text TEXT;
ALTER TABLE workspace_member ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;
DELETE FROM productivity_item_order_entry
WHERE item_id IN (SELECT id FROM productivity_item WHERE deleted_at_utc IS NOT NULL);
"#;

// Item classification stays in the Archive transaction boundary (SPEC-0003 §12.6).
const MIGRATION_V9: &str = r#"
ALTER TABLE productivity_item ADD COLUMN item_type_id TEXT;
CREATE TABLE productivity_item_type_catalog (
  id TEXT PRIMARY KEY, revision INTEGER NOT NULL, created_at_utc TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL, deleted_at_utc TEXT, extra_json TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE productivity_item_type (
  id TEXT PRIMARY KEY, catalog_id TEXT NOT NULL REFERENCES productivity_item_type_catalog(id),
  parent_item_type_id TEXT REFERENCES productivity_item_type(id),
  name TEXT NOT NULL, name_key TEXT NOT NULL UNIQUE, color_override TEXT,
  inactive INTEGER NOT NULL DEFAULT 0, created_at_utc TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL, extra_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX idx_item_type_parent ON productivity_item_type(parent_item_type_id);
CREATE TABLE productivity_tag (
  id TEXT PRIMARY KEY, revision INTEGER NOT NULL, name TEXT NOT NULL,
  name_key TEXT NOT NULL UNIQUE, inactive INTEGER NOT NULL DEFAULT 0,
  created_at_utc TEXT NOT NULL, updated_at_utc TEXT NOT NULL,
  deleted_at_utc TEXT, extra_json TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE productivity_item_tag (
  item_id TEXT NOT NULL REFERENCES productivity_item(id),
  tag_id TEXT NOT NULL REFERENCES productivity_tag(id),
  PRIMARY KEY(item_id, tag_id)
);
CREATE INDEX idx_item_tag_tag ON productivity_item_tag(tag_id);
CREATE INDEX idx_item_type_id ON productivity_item(item_type_id);
"#;

const MIGRATION_V10: &str = r#"
CREATE TABLE IF NOT EXISTS garmin_scan (
  scan_id TEXT PRIMARY KEY,
  data_dir_key TEXT NOT NULL,
  from_date TEXT NOT NULL,
  to_date TEXT NOT NULL,
  timezone_policy TEXT NOT NULL,
  mode TEXT NOT NULL,
  force_details INTEGER NOT NULL DEFAULT 0,
  force_original INTEGER NOT NULL DEFAULT 0,
  state TEXT NOT NULL,
  page_cursor TEXT,
  page_evidence_json TEXT NOT NULL DEFAULT '{}',
  manifest_hash TEXT,
  revision INTEGER NOT NULL,
  error_code TEXT,
  error_summary TEXT,
  created_at_utc TEXT NOT NULL,
  finished_at_utc TEXT
);
CREATE INDEX IF NOT EXISTS idx_garmin_scan_dir_state ON garmin_scan(data_dir_key, state);

CREATE TABLE IF NOT EXISTS garmin_scan_activity (
  scan_id TEXT NOT NULL,
  external_id TEXT NOT NULL,
  type_key TEXT,
  list_fields_json TEXT NOT NULL DEFAULT '{}',
  sort_key TEXT NOT NULL,
  coverage_snapshot_json TEXT NOT NULL DEFAULT '{}',
  plan_class TEXT NOT NULL,
  PRIMARY KEY (scan_id, external_id)
);

CREATE TABLE IF NOT EXISTS garmin_sync_job (
  job_id TEXT PRIMARY KEY,
  data_dir_key TEXT NOT NULL,
  kind TEXT NOT NULL,
  from_date TEXT NOT NULL,
  to_date TEXT NOT NULL,
  timezone_policy TEXT NOT NULL,
  intent TEXT NOT NULL,
  force_details INTEGER NOT NULL DEFAULT 0,
  force_original INTEGER NOT NULL DEFAULT 0,
  scan_id TEXT,
  manifest_hash TEXT,
  state TEXT NOT NULL,
  pause_reason TEXT,
  revision INTEGER NOT NULL,
  phase_stats_json TEXT NOT NULL DEFAULT '{}',
  error_code TEXT,
  error_summary TEXT,
  request_id TEXT,
  created_at_utc TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL,
  started_at_utc TEXT,
  finished_at_utc TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_garmin_job_one_advanced
  ON garmin_sync_job(data_dir_key)
  WHERE kind = 'advanced'
    AND state NOT IN ('completed','partial','cancelled','failed','core_success','core_partial');

CREATE TABLE IF NOT EXISTS garmin_sync_work_item (
  work_item_id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  target_key TEXT NOT NULL,
  priority INTEGER NOT NULL,
  state TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  attempt_generation INTEGER NOT NULL,
  next_attempt_at_utc TEXT,
  idempotency_key TEXT NOT NULL,
  input_hash TEXT,
  committed_hash TEXT,
  asset_version_id TEXT,
  revision INTEGER NOT NULL,
  error_code TEXT,
  result_code TEXT,
  UNIQUE (job_id, kind, target_key, attempt_generation)
);
CREATE INDEX IF NOT EXISTS idx_garmin_work_priority
  ON garmin_sync_work_item(priority, state);
"#;

// Request ids are durable idempotency keys scoped to the archive dataDir.
const MIGRATION_V11: &str = r#"
ALTER TABLE garmin_scan ADD COLUMN request_id TEXT;
UPDATE garmin_scan SET request_id = COALESCE(json_extract(page_evidence_json, '$.requestId'), 'legacy:' || scan_id)
  WHERE request_id IS NULL;
UPDATE garmin_sync_job SET request_id = NULL
  WHERE request_id IS NOT NULL AND job_id NOT IN (
    SELECT MIN(job_id) FROM garmin_sync_job WHERE request_id IS NOT NULL GROUP BY data_dir_key, request_id
  );
UPDATE garmin_scan SET request_id = 'legacy:' || scan_id
  WHERE request_id IS NOT NULL AND scan_id NOT IN (
    SELECT MIN(scan_id) FROM garmin_scan WHERE request_id IS NOT NULL GROUP BY data_dir_key, request_id
  );
CREATE UNIQUE INDEX IF NOT EXISTS idx_garmin_scan_request
  ON garmin_scan(data_dir_key, request_id) WHERE request_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_garmin_job_request
  ON garmin_sync_job(data_dir_key, request_id) WHERE request_id IS NOT NULL;
"#;

// SPEC-0003 U160: every pre-existing Action stays independent of its target title.
// This migration changes no business revision, title, target, plan, or Interval.
const MIGRATION_V12: &str = r#"
ALTER TABLE productivity_action ADD COLUMN name_link_mode TEXT NOT NULL DEFAULT 'unlinked'
  CHECK (name_link_mode IN ('initial-linked', 'manually-linked', 'unlinked'));
"#;

// Travel is an owned Item aggregate.  The tables deliberately retain unknown
// provider payloads and tombstones so a newer client cannot erase data it does
// not understand (SPEC-0007 / ADR-0042).
const MIGRATION_V13: &str = r#"
ALTER TABLE productivity_item_type ADD COLUMN system_role TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_item_type_system_role
  ON productivity_item_type(catalog_id, system_role) WHERE system_role IS NOT NULL;
CREATE TABLE IF NOT EXISTS productivity_item_travel_detail (
  item_id TEXT PRIMARY KEY REFERENCES productivity_item(id),
  schema_version INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('flight', 'train')),
  service_number TEXT,
  operator_code TEXT,
  operator_name TEXT,
  carriage TEXT,
  seat_number TEXT,
  source_snapshot_json TEXT NOT NULL DEFAULT '{}',
  deletion_batch_id TEXT,
  created_at_utc TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL,
  deleted_at_utc TEXT,
  extra_json TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS productivity_item_travel_leg (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES productivity_item(id),
  action_id TEXT NOT NULL UNIQUE REFERENCES productivity_action(id),
  position INTEGER NOT NULL,
  departure_code TEXT,
  departure_name TEXT,
  arrival_code TEXT,
  arrival_name TEXT,
  departure_terminal TEXT,
  arrival_terminal TEXT,
  source_snapshot_json TEXT NOT NULL DEFAULT '{}',
  deletion_batch_id TEXT,
  created_at_utc TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL,
  deleted_at_utc TEXT,
  extra_json TEXT NOT NULL DEFAULT '{}',
  UNIQUE(item_id, position)
);
CREATE INDEX IF NOT EXISTS idx_travel_leg_item ON productivity_item_travel_leg(item_id, position);
CREATE INDEX IF NOT EXISTS idx_travel_leg_action ON productivity_item_travel_leg(action_id);
"#;

// Flight fields confirmed for the first editable travel detail surface.
const MIGRATION_V14: &str = r#"
ALTER TABLE productivity_item_travel_detail ADD COLUMN aircraft_type TEXT;
ALTER TABLE productivity_item_travel_leg ADD COLUMN departure_gate TEXT;
ALTER TABLE productivity_item_travel_leg ADD COLUMN arrival_gate TEXT;
"#;

// SPEC-0009: managed detail follows the Item tombstone; the partial unique
// index deliberately reserves invalid references until the plan is deleted.
const MIGRATION_V15: &str = r#"
CREATE TABLE productivity_item_health_plan (
 item_id TEXT PRIMARY KEY REFERENCES productivity_item(id),
 action_id TEXT NOT NULL UNIQUE REFERENCES productivity_action(id),
 kind TEXT NOT NULL CHECK(kind IN ('sleep','activity')),
 activity_type TEXT,
 health_kind TEXT CHECK(health_kind IN ('sleep-night','nap','activity')),
 health_id TEXT,
 auto_match_enabled INTEGER NOT NULL DEFAULT 1 CHECK(auto_match_enabled IN (0,1)),
 deleted_at_utc TEXT,
 deletion_batch_id TEXT,
 CHECK((health_kind IS NULL) = (health_id IS NULL))
);
CREATE UNIQUE INDEX idx_health_plan_source ON productivity_item_health_plan(health_kind,health_id) WHERE health_id IS NOT NULL AND deleted_at_utc IS NULL;
"#;

// Checkpoint is an independent root with point facts; it never writes Action intervals.
const MIGRATION_V16: &str = r#"
CREATE TABLE productivity_checkpoint (
 id TEXT PRIMARY KEY,
 schema_version INTEGER NOT NULL DEFAULT 1 CHECK(schema_version > 0),
 revision INTEGER NOT NULL,
 title TEXT NOT NULL,
 description TEXT,
 appearance_json TEXT NOT NULL DEFAULT '{}',
 planned_at_utc TEXT,
 actual_at_utc TEXT,
 completed INTEGER NOT NULL DEFAULT 0 CHECK(completed IN (0,1)),
 session_id TEXT REFERENCES productivity_session(id),
 target_kind TEXT,
 target_id TEXT,
 deletion_batch_id TEXT,
 created_at_utc TEXT NOT NULL,
 updated_at_utc TEXT NOT NULL,
 deleted_at_utc TEXT,
 extra_json TEXT NOT NULL DEFAULT '{}',
 CHECK((target_kind IS NULL) = (target_id IS NULL)),
 CHECK(actual_at_utc IS NULL OR completed=1)
);
CREATE INDEX idx_productivity_checkpoint_planned ON productivity_checkpoint(planned_at_utc) WHERE deleted_at_utc IS NULL;
CREATE INDEX idx_productivity_checkpoint_session ON productivity_checkpoint(session_id) WHERE deleted_at_utc IS NULL;
"#;

// SPEC-0011: old checkpoint names remain independent; only new rows choose an explicit link mode.
const MIGRATION_V17: &str = r#"
ALTER TABLE productivity_checkpoint ADD COLUMN name_link_mode TEXT NOT NULL DEFAULT 'unlinked'
  CHECK (name_link_mode IN ('initial-linked', 'manually-linked', 'unlinked'));
"#;

// Travel v2 (SPEC travel-item-storage): profile, transportation, points, actual v2, batches, receipts.
const MIGRATION_V18: &str = r#"
CREATE TABLE productivity_item_travel_profile (
  item_id TEXT PRIMARY KEY REFERENCES productivity_item(id),
  schema_version INTEGER NOT NULL DEFAULT 1 CHECK(schema_version > 0),
  cancelled_at_utc TEXT,
  created_at_utc TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL,
  deleted_at_utc TEXT
);

CREATE TABLE productivity_transportation (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES productivity_item(id),
  schema_version INTEGER NOT NULL DEFAULT 1 CHECK(schema_version > 0),
  transportation_type TEXT,
  name TEXT,
  note TEXT,
  service_number TEXT,
  operator TEXT,
  vehicle_model TEXT,
  aircraft_registration TEXT,
  license_plate TEXT,
  carriage TEXT,
  seat TEXT,
  departure_name TEXT,
  arrival_name TEXT,
  departure_code TEXT,
  arrival_code TEXT,
  departure_terminal TEXT,
  arrival_terminal TEXT,
  departure_gate TEXT,
  arrival_gate TEXT,
  source_snapshot_json TEXT,
  created_at_utc TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL,
  deleted_at_utc TEXT
);

ALTER TABLE productivity_action ADD COLUMN transportation_id TEXT REFERENCES productivity_transportation(id);

CREATE TABLE productivity_item_travel_point (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES productivity_item(id),
  schema_version INTEGER NOT NULL DEFAULT 1 CHECK(schema_version > 0),
  attachment_kind TEXT NOT NULL CHECK(attachment_kind IN ('action','checkpoint')),
  action_id TEXT REFERENCES productivity_action(id),
  checkpoint_id TEXT REFERENCES productivity_checkpoint(id),
  role TEXT NOT NULL CHECK(role IN ('start','end','single')),
  action_label TEXT,
  location TEXT,
  note TEXT,
  origin_checkpoint_id TEXT REFERENCES productivity_checkpoint(id),
  created_at_utc TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL,
  deleted_at_utc TEXT,
  CHECK(
    (attachment_kind='action' AND action_id IS NOT NULL AND checkpoint_id IS NULL AND role IN ('start','end'))
    OR (attachment_kind='checkpoint' AND checkpoint_id IS NOT NULL AND action_id IS NULL AND role='single')
  )
);

CREATE UNIQUE INDEX idx_travel_point_action_role
  ON productivity_item_travel_point(action_id, role) WHERE deleted_at_utc IS NULL AND action_id IS NOT NULL;
CREATE UNIQUE INDEX idx_travel_point_checkpoint
  ON productivity_item_travel_point(checkpoint_id) WHERE deleted_at_utc IS NULL AND checkpoint_id IS NOT NULL;

CREATE TABLE productivity_action_travel_actual_v2 (
  action_id TEXT PRIMARY KEY REFERENCES productivity_action(id),
  schema_version INTEGER NOT NULL DEFAULT 1 CHECK(schema_version > 0),
  interval_id TEXT UNIQUE REFERENCES productivity_interval(id),
  pending_start_at_utc TEXT,
  pending_end_at_utc TEXT,
  start_origin TEXT CHECK(start_origin IS NULL OR start_origin IN ('manual','source')),
  end_origin TEXT CHECK(end_origin IS NULL OR end_origin IN ('manual','source')),
  start_source_ref TEXT,
  end_source_ref TEXT,
  start_auto_fill_block INTEGER NOT NULL DEFAULT 0 CHECK(start_auto_fill_block IN (0,1)),
  end_auto_fill_block INTEGER NOT NULL DEFAULT 0 CHECK(end_auto_fill_block IN (0,1)),
  created_at_utc TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL,
  deleted_at_utc TEXT
);

CREATE TABLE productivity_item_travel_mutation_batch (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES productivity_item(id),
  schema_version INTEGER NOT NULL DEFAULT 1 CHECK(schema_version > 0),
  kind TEXT NOT NULL CHECK(kind IN ('stage_delete','trip_delete','cp_conversion')),
  manifest_version INTEGER NOT NULL DEFAULT 1,
  manifest_json TEXT NOT NULL,
  restored_at_utc TEXT,
  created_at_utc TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL,
  deleted_at_utc TEXT
);

CREATE TABLE productivity_travel_command_receipt (
  request_id TEXT PRIMARY KEY,
  request_hash TEXT NOT NULL,
  item_id TEXT,
  result_json TEXT NOT NULL,
  created_at_utc TEXT NOT NULL
);

CREATE INDEX idx_action_transportation ON productivity_action(transportation_id, deleted_at_utc);
CREATE INDEX idx_transportation_item ON productivity_transportation(item_id, deleted_at_utc, transportation_type);
CREATE INDEX idx_travel_point_item ON productivity_item_travel_point(item_id, deleted_at_utc);
CREATE INDEX idx_travel_batch_item ON productivity_item_travel_mutation_batch(item_id, created_at_utc);
CREATE INDEX idx_action_target_planned ON productivity_action(target_kind, target_id, deleted_at_utc, planned_start_at);
"#;

// Retire the legacy travel classification tree. Existing travel records keep
// their data and only lose the removed classification reference.
const MIGRATION_V19: &str = r#"
UPDATE productivity_item SET item_type_id = NULL
WHERE item_type_id IN (SELECT id FROM productivity_item_type WHERE system_role IN ('travel', 'travel.flight', 'travel.train'));
UPDATE productivity_item_type SET parent_item_type_id = NULL
WHERE parent_item_type_id IN (SELECT id FROM productivity_item_type WHERE system_role = 'travel') AND system_role IS NULL;
DELETE FROM productivity_item_type WHERE system_role IN ('travel.flight', 'travel.train', 'travel');
INSERT INTO productivity_item_type(id, catalog_id, parent_item_type_id, name, name_key, color_override, inactive, created_at_utc, updated_at_utc, system_role)
SELECT lower(hex(randomblob(16))), c.id, NULL, '出行', 'travel', '#4879ED', 0,
  strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'), 'travel'
FROM productivity_item_type_catalog c
WHERE NOT EXISTS (SELECT 1 FROM productivity_item_type WHERE system_role = 'travel')
  AND NOT EXISTS (SELECT 1 FROM productivity_item_type WHERE name_key IN ('travel', '出行'))
LIMIT 1;
"#;

// Rebind travel profiles to their one canonical ItemType after retiring the
// previous classification tree.
const MIGRATION_V20: &str = r#"
UPDATE productivity_item_type
SET system_role = 'travel'
WHERE system_role = 'travel.v2';

UPDATE productivity_item
SET item_type_id = (
  SELECT id FROM productivity_item_type
  WHERE system_role = 'travel' AND inactive = 0
  LIMIT 1
)
WHERE id IN (SELECT item_id FROM productivity_item_travel_profile)
  AND EXISTS (
    SELECT 1 FROM productivity_item_type
    WHERE system_role = 'travel' AND inactive = 0
  );
"#;

// There is one travel ItemType. The temporary `travel.v2` role was only used
// while replacing the retired legacy tree; retain no second taxonomy.
const MIGRATION_V21: &str = r#"
UPDATE productivity_item_type
SET system_role = 'travel'
WHERE system_role = 'travel.v2';
"#;

// SPEC-0012: relations and shared layout are Project-owned facts. Tombstones
// retain history for exact subtree restoration; no physical cascade is used.
const MIGRATION_V22: &str = r#"
CREATE TABLE productivity_task_sequence_edge (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES productivity_project(id),
  source_task_id TEXT NOT NULL REFERENCES productivity_task(id),
  target_task_id TEXT NOT NULL REFERENCES productivity_task(id),
  created_at_utc TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL,
  deleted_at_utc TEXT,
  deletion_batch_id TEXT,
  extra_json TEXT NOT NULL DEFAULT '{}',
  CHECK(source_task_id <> target_task_id)
);
CREATE UNIQUE INDEX idx_task_sequence_edge_live_pair
  ON productivity_task_sequence_edge(project_id,source_task_id,target_task_id)
  WHERE deleted_at_utc IS NULL;
CREATE INDEX idx_task_sequence_edge_source
  ON productivity_task_sequence_edge(project_id,source_task_id,deleted_at_utc);
CREATE INDEX idx_task_sequence_edge_target
  ON productivity_task_sequence_edge(project_id,target_task_id,deleted_at_utc);

CREATE TABLE productivity_task_card_position (
  task_id TEXT PRIMARY KEY REFERENCES productivity_task(id),
  project_id TEXT NOT NULL REFERENCES productivity_project(id),
  parent_task_id TEXT NOT NULL REFERENCES productivity_task(id),
  x REAL NOT NULL,
  y REAL NOT NULL,
  updated_at_utc TEXT NOT NULL,
  deleted_at_utc TEXT,
  extra_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX idx_task_card_position_project_parent
  ON productivity_task_card_position(project_id,parent_task_id,deleted_at_utc);
"#;

// Manual endpoint choices are explicit edge metadata, never extra_json.
// Keep nullable defaults so existing automatic connections and tombstones survive;
// migration policy: docs/adr/0018-local-archive-sqlite-lifecycle.md.
const MIGRATION_V23: &str = r#"
ALTER TABLE productivity_task_sequence_edge ADD COLUMN source_anchor_json TEXT;
ALTER TABLE productivity_task_sequence_edge ADD COLUMN target_anchor_json TEXT;
"#;

const MIGRATION_V24: &str = r#"
ALTER TABLE productivity_task ADD COLUMN item_type_id TEXT;
CREATE INDEX idx_task_item_type ON productivity_task(item_type_id);
"#;

const MIGRATION_V25: &str = r#"
ALTER TABLE health_meal ADD COLUMN record_shape TEXT NOT NULL DEFAULT 'legacy'
  CHECK(record_shape IN ('legacy', 'foods'));
ALTER TABLE health_meal ADD COLUMN icon_key TEXT;
UPDATE health_meal SET record_shape = CASE
  WHEN title IS NOT NULL AND trim(title) != '' THEN 'foods'
  ELSE 'legacy'
END;
"#;

pub fn read_schema_version(conn: &Connection) -> DomainResult<Option<i32>> {
    let exists: bool = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='archive_meta'",
            [],
            |row| row.get(0),
        )
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    if !exists {
        return Ok(None);
    }
    let version = conn
        .query_row(
            "SELECT value FROM archive_meta WHERE key = 'schema_version'",
            [],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    match version {
        Some(v) => v
            .parse()
            .map(Some)
            .map_err(|_| DomainError::archive_lifecycle("invalid schema_version")),
        None => Ok(None),
    }
}

pub fn initialize_fresh(conn: &Connection) -> DomainResult<()> {
    let tx = conn
        .unchecked_transaction()
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    tx.execute_batch(MIGRATION_V1)
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    tx.execute_batch(MIGRATION_V2)
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    tx.execute_batch(MIGRATION_V3)
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    tx.execute_batch(MIGRATION_V4)
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    tx.execute_batch(MIGRATION_V5)
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    tx.execute_batch(MIGRATION_V6)
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    tx.execute_batch(MIGRATION_V7)
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    tx.execute_batch(MIGRATION_V8)
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    tx.execute_batch(MIGRATION_V9)
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    tx.execute_batch(MIGRATION_V10)
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    tx.execute_batch(MIGRATION_V11)
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    tx.execute_batch(MIGRATION_V12)
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    tx.execute_batch(MIGRATION_V13)
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    tx.execute_batch(MIGRATION_V14)
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    tx.execute_batch(MIGRATION_V15)
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    tx.execute_batch(MIGRATION_V16)
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    tx.execute_batch(MIGRATION_V17)
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    tx.execute_batch(MIGRATION_V18)
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    tx.execute_batch(MIGRATION_V19)
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    tx.execute_batch(MIGRATION_V20)
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    tx.execute_batch(MIGRATION_V21)
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    tx.execute_batch(MIGRATION_V22)
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    tx.execute_batch(MIGRATION_V23)
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    tx.execute_batch(MIGRATION_V24)
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    tx.execute_batch(MIGRATION_V25)
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    tx.execute_batch(super::travel_foundation::TRAVEL_FOUNDATION_SCHEMA_SQL)
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    tx.execute(
        "INSERT INTO archive_meta (key, value) VALUES ('schema_version', ?1), ('base_timezone_offset', ?2)",
        rusqlite::params![CURRENT_SCHEMA_VERSION.to_string(), BASE_TIMEZONE_OFFSET],
    )
    .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    tx.commit()
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    Ok(())
}

pub fn ensure_schema(conn: &Connection, db_path: &Path) -> DomainResult<()> {
    let version = read_schema_version(conn)?;
    match version {
        None => initialize_fresh(conn),
        Some(v) if v > CURRENT_SCHEMA_VERSION => Err(DomainError::archive_lifecycle(
            "archive schema is newer than this application supports",
        )),
        Some(v) if v < CURRENT_SCHEMA_VERSION => migrate(conn, db_path, v),
        Some(_) => Ok(()),
    }
}

fn migrate(conn: &Connection, db_path: &Path, from: i32) -> DomainResult<()> {
    use rusqlite::backup::Backup;
    use std::time::Duration;

    let archive_root = db_path
        .parent()
        .ok_or_else(|| DomainError::archive_lifecycle("invalid archive path"))?;
    let backups_dir = archive_root.join("backups");
    std::fs::create_dir_all(&backups_dir)
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    let stamp = chrono::Utc::now().format("%Y%m%dT%H%M%SZ");
    let backup_path = backups_dir.join(format!(
        "archive-pre-migrate-{stamp}-{}.sqlite",
        uuid::Uuid::new_v4()
    ));
    std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&backup_path)
        .map_err(|e| DomainError::archive_lifecycle(format!("cannot reserve migration backup path: {e}")))?;
    {
        let mut dest = Connection::open(&backup_path)
            .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
        let backup = Backup::new(conn, &mut dest)
            .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
        backup
            .run_to_completion(5, Duration::from_millis(100), None)
            .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    }
    let verify = Connection::open(&backup_path)
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    integrity_check(&verify)?;
    drop(verify);

    let tx = conn
        .unchecked_transaction()
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    let mut cur = from;
    while cur < CURRENT_SCHEMA_VERSION {
        cur += 1;
        match cur {
            1 => tx
                .execute_batch(MIGRATION_V1)
                .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?,
            2 => tx
                .execute_batch(MIGRATION_V2)
                .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?,
            3 => tx
                .execute_batch(MIGRATION_V3)
                .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?,
            4 => tx
                .execute_batch(MIGRATION_V4)
                .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?,
            5 => tx
                .execute_batch(MIGRATION_V5)
                .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?,
            6 => tx
                .execute_batch(MIGRATION_V6)
                .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?,
            7 => tx
                .execute_batch(MIGRATION_V7)
                .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?,
            8 => tx
                .execute_batch(MIGRATION_V8)
                .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?,
            9 => tx
                .execute_batch(MIGRATION_V9)
                .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?,
            10 => tx
                .execute_batch(MIGRATION_V10)
                .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?,
            11 => tx
                .execute_batch(MIGRATION_V11)
                .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?,
            12 => tx
                .execute_batch(MIGRATION_V12)
                .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?,
            13 => tx
                .execute_batch(MIGRATION_V13)
                .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?,
            14 => tx
                .execute_batch(MIGRATION_V14)
                .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?,
            15 => tx
                .execute_batch(MIGRATION_V15)
                .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?,
            16 => {
                tx.execute_batch(MIGRATION_V16)
                    .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
                tx.execute_batch(super::travel_foundation::TRAVEL_FOUNDATION_SCHEMA_SQL)
                    .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
            }
            17 => tx.execute_batch(MIGRATION_V17).map_err(|e| DomainError::archive_lifecycle(e.to_string()))?,
            18 => tx.execute_batch(MIGRATION_V18).map_err(|e| DomainError::archive_lifecycle(e.to_string()))?,
            19 => tx.execute_batch(MIGRATION_V19).map_err(|e| DomainError::archive_lifecycle(e.to_string()))?,
            20 => tx.execute_batch(MIGRATION_V20).map_err(|e| DomainError::archive_lifecycle(e.to_string()))?,
            21 => tx.execute_batch(MIGRATION_V21).map_err(|e| DomainError::archive_lifecycle(e.to_string()))?,
            22 => tx.execute_batch(MIGRATION_V22).map_err(|e| DomainError::archive_lifecycle(e.to_string()))?,
            23 => tx.execute_batch(MIGRATION_V23).map_err(|e| DomainError::archive_lifecycle(e.to_string()))?,
            24 => tx.execute_batch(MIGRATION_V24).map_err(|e| DomainError::archive_lifecycle(e.to_string()))?,
            25 => tx.execute_batch(MIGRATION_V25).map_err(|e| DomainError::archive_lifecycle(e.to_string()))?,
            _ => {
                return Err(DomainError::archive_lifecycle("unsupported migration step"));
            }
        }
        tx.execute(
            "INSERT OR REPLACE INTO archive_meta (key, value) VALUES ('schema_version', ?1)",
            [cur.to_string()],
        )
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    }
    tx.commit()
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    prune_backups(&backups_dir, 3)?;
    Ok(())
}

fn prune_backups(dir: &Path, keep: usize) -> DomainResult<()> {
    let mut files: Vec<(std::time::SystemTime, PathBuf)> = Vec::new();
    for entry in std::fs::read_dir(dir).map_err(|e| DomainError::archive_lifecycle(e.to_string()))? {
        let entry = entry.map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
        let path = entry.path();
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if !name.starts_with("archive-pre-migrate-") || path.extension().map(|ext| ext != "sqlite").unwrap_or(true) {
            continue;
        }
        let metadata = entry.metadata().map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
        if !metadata.is_file() { continue; }
        let modified = metadata.modified().map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
        files.push((modified, path));
    }
    files.sort_by_key(|(modified, _)| *modified);
    while files.len() > keep {
        let (_, oldest) = files.remove(0);
        std::fs::remove_file(oldest).map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    }
    Ok(())
}

pub fn integrity_check(conn: &Connection) -> DomainResult<()> {
    let result = conn
        .query_row("PRAGMA integrity_check", [], |row| row.get::<_, String>(0))
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    if result != "ok" {
        return Err(DomainError::archive_lifecycle(format!(
            "integrity check failed: {result}"
        )));
    }
    Ok(())
}
