use rusqlite::{params, Connection, OptionalExtension, Transaction};

use super::StoreError;

const SCHEMA_VERSION: i64 = 1;

const DDL: &str = r#"
CREATE TABLE finance_v2_meta (
  schema_version INTEGER NOT NULL PRIMARY KEY CHECK(schema_version = 1)
);
CREATE TABLE finance_v2_ledger_state (
  singleton INTEGER NOT NULL PRIMARY KEY CHECK(singleton = 1),
  generation INTEGER NOT NULL CHECK(generation >= 0)
);
INSERT INTO finance_v2_ledger_state(singleton,generation) VALUES (1,0);
CREATE TABLE finance_v2_commit_receipts (
  operation_id TEXT NOT NULL PRIMARY KEY,
  receipt_id TEXT NOT NULL UNIQUE,
  payload_sha256 TEXT NOT NULL CHECK(length(payload_sha256)=64 AND payload_sha256 NOT GLOB '*[^0-9a-f]*'),
  committed_generation INTEGER NOT NULL UNIQUE CHECK(committed_generation >= 1),
  id_map_json TEXT NOT NULL,
  committed_at_utc_us INTEGER NOT NULL
);
CREATE TRIGGER finance_v2_commit_receipts_no_update BEFORE UPDATE ON finance_v2_commit_receipts
  BEGIN SELECT RAISE(ABORT, 'finance_v2 commit receipts are immutable'); END;
CREATE TRIGGER finance_v2_commit_receipts_no_delete BEFORE DELETE ON finance_v2_commit_receipts
  BEGIN SELECT RAISE(ABORT, 'finance_v2 commit receipts are immutable'); END;
CREATE TABLE finance_v2_materialization_jobs (
  job_id TEXT NOT NULL PRIMARY KEY,
  operation_id TEXT NOT NULL UNIQUE,
  generation INTEGER NOT NULL UNIQUE CHECK(generation >= 1),
  status TEXT NOT NULL CHECK(status IN ('pending','running','ready','failed')),
  input_sha256 TEXT NOT NULL CHECK(length(input_sha256)=64 AND input_sha256 NOT GLOB '*[^0-9a-f]*'),
  output_sha256 TEXT,
  error_code TEXT,
  error_detail TEXT,
  created_at_utc_us INTEGER NOT NULL,
  updated_at_utc_us INTEGER NOT NULL,
  FOREIGN KEY(operation_id) REFERENCES finance_v2_commit_receipts(operation_id) ON DELETE RESTRICT
);
CREATE TABLE finance_v2_l0_change_audit (
  fact_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  operation_id TEXT NOT NULL,
  changed_at_utc_us INTEGER NOT NULL,
  reason TEXT NOT NULL CHECK(length(trim(reason)) > 0),
  PRIMARY KEY(fact_id,revision),
  FOREIGN KEY(fact_id,revision) REFERENCES finance_v2_l0_versions(id,revision) ON DELETE RESTRICT
);
CREATE TRIGGER finance_v2_l0_change_audit_no_update BEFORE UPDATE ON finance_v2_l0_change_audit
  BEGIN SELECT RAISE(ABORT, 'finance_v2 L0 change audits are immutable'); END;
CREATE TRIGGER finance_v2_l0_change_audit_no_delete BEFORE DELETE ON finance_v2_l0_change_audit
  BEGIN SELECT RAISE(ABORT, 'finance_v2 L0 change audits are immutable'); END;
CREATE TABLE finance_v2_treatment_change_audit (
  treatment_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  operation_id TEXT NOT NULL,
  changed_at_utc_us INTEGER NOT NULL,
  reason TEXT NOT NULL CHECK(length(trim(reason)) > 0),
  PRIMARY KEY(treatment_id,revision),
  FOREIGN KEY(treatment_id,revision) REFERENCES finance_v2_treatment_versions(id,revision) ON DELETE RESTRICT
);
CREATE TRIGGER finance_v2_treatment_change_audit_no_update BEFORE UPDATE ON finance_v2_treatment_change_audit
  BEGIN SELECT RAISE(ABORT, 'finance_v2 treatment change audits are immutable'); END;
CREATE TRIGGER finance_v2_treatment_change_audit_no_delete BEFORE DELETE ON finance_v2_treatment_change_audit
  BEGIN SELECT RAISE(ABORT, 'finance_v2 treatment change audits are immutable'); END;
CREATE TABLE finance_v2_binding_state (
  singleton INTEGER NOT NULL PRIMARY KEY CHECK(singleton = 1),
  revision INTEGER NOT NULL CHECK(revision >= 0)
);
INSERT INTO finance_v2_binding_state(singleton,revision) VALUES (1,0);
CREATE TABLE finance_v2_source_context_state (
  singleton INTEGER NOT NULL PRIMARY KEY CHECK(singleton = 1),
  revision INTEGER NOT NULL CHECK(revision >= 0)
);
INSERT INTO finance_v2_source_context_state(singleton,revision) VALUES (1,0);
CREATE TABLE finance_v2_source_context_current (
  id TEXT NOT NULL PRIMARY KEY,
  revision INTEGER NOT NULL,
  UNIQUE(id,revision),
  FOREIGN KEY(id,revision) REFERENCES finance_v2_source_context_versions(id,revision) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE finance_v2_source_context_versions (
  id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision >= 1),
  label TEXT NOT NULL CHECK(length(trim(label)) > 0),
  provider TEXT NOT NULL CHECK(length(trim(provider)) > 0),
  scope TEXT NOT NULL CHECK(length(trim(scope)) > 0),
  date_semantics TEXT NOT NULL CHECK(length(trim(date_semantics)) > 0),
  active INTEGER NOT NULL CHECK(active IN (0,1)),
  recorded_at_utc_us INTEGER NOT NULL,
  PRIMARY KEY(id,revision),
  FOREIGN KEY(id) REFERENCES finance_v2_source_context_current(id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED
);
CREATE TRIGGER finance_v2_source_context_current_insert_matches_version
  BEFORE INSERT ON finance_v2_source_context_current
  WHEN NOT EXISTS(SELECT 1 FROM finance_v2_source_context_versions v WHERE v.id=NEW.id AND v.revision=NEW.revision)
  BEGIN SELECT RAISE(ABORT, 'finance_v2 source context pointer mismatch'); END;
CREATE TRIGGER finance_v2_source_context_current_update_matches_version
  BEFORE UPDATE ON finance_v2_source_context_current
  WHEN NEW.id <> OLD.id OR NEW.revision <> OLD.revision + 1 OR NOT EXISTS(SELECT 1 FROM finance_v2_source_context_versions v WHERE v.id=NEW.id AND v.revision=NEW.revision)
  BEGIN SELECT RAISE(ABORT, 'finance_v2 source context pointer mismatch'); END;
CREATE TRIGGER finance_v2_source_context_current_insert_step
  BEFORE INSERT ON finance_v2_source_context_current
  WHEN NEW.revision <> 1
  BEGIN SELECT RAISE(ABORT, 'finance_v2 source context must start at revision 1'); END;
CREATE TRIGGER finance_v2_source_context_current_update_step
  BEFORE UPDATE ON finance_v2_source_context_current
  WHEN NEW.id <> OLD.id OR NEW.revision <> OLD.revision + 1
  BEGIN SELECT RAISE(ABORT, 'finance_v2 source context revision must advance by one'); END;
CREATE TRIGGER finance_v2_source_context_versions_no_update BEFORE UPDATE ON finance_v2_source_context_versions
  BEGIN SELECT RAISE(ABORT, 'finance_v2 source context versions are immutable'); END;
CREATE TRIGGER finance_v2_source_context_versions_no_delete BEFORE DELETE ON finance_v2_source_context_versions
  BEGIN SELECT RAISE(ABORT, 'finance_v2 source context versions are immutable'); END;
CREATE TABLE finance_v2_account_via_state (
  singleton INTEGER NOT NULL PRIMARY KEY CHECK(singleton = 1),
  revision INTEGER NOT NULL CHECK(revision >= 0)
);
INSERT INTO finance_v2_account_via_state(singleton,revision) VALUES (1,0);
CREATE TABLE finance_v2_accounts (
  id TEXT NOT NULL PRIMARY KEY,
  revision INTEGER NOT NULL CHECK(revision >= 1),
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('Assets','Liabilities','Equity','Income','Expenses')),
  bean_path TEXT,
  parent_id TEXT,
  active INTEGER NOT NULL CHECK(active IN (0,1)),
  ever_used INTEGER NOT NULL DEFAULT 0 CHECK(ever_used IN (0,1)),
  UNIQUE(id, revision),
  FOREIGN KEY(id, revision) REFERENCES finance_v2_account_history(account_id, revision)
    ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY(parent_id) REFERENCES finance_v2_accounts(id) ON DELETE RESTRICT
);
CREATE TABLE finance_v2_account_history (
  account_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision >= 1),
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('Assets','Liabilities','Equity','Income','Expenses')),
  bean_path TEXT,
  parent_id TEXT,
  active INTEGER NOT NULL CHECK(active IN (0,1)),
  recorded_at_utc_us INTEGER NOT NULL,
  PRIMARY KEY(account_id, revision),
  FOREIGN KEY(account_id) REFERENCES finance_v2_accounts(id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY(parent_id) REFERENCES finance_v2_accounts(id) ON DELETE RESTRICT
);
CREATE TRIGGER finance_v2_accounts_insert_matches_history
  BEFORE INSERT ON finance_v2_accounts
  WHEN NEW.revision <> 1 OR NOT EXISTS(SELECT 1 FROM finance_v2_account_history h WHERE h.account_id=NEW.id AND h.revision=NEW.revision AND h.name=NEW.name AND h.kind=NEW.kind AND h.bean_path IS NEW.bean_path AND h.parent_id IS NEW.parent_id AND h.active=NEW.active)
  BEGIN SELECT RAISE(ABORT, 'finance_v2 account current/history mismatch'); END;
CREATE TRIGGER finance_v2_accounts_update_matches_history
  BEFORE UPDATE ON finance_v2_accounts
  WHEN NEW.id <> OLD.id OR (OLD.ever_used=1 AND NEW.ever_used<>1) OR NOT EXISTS(SELECT 1 FROM finance_v2_account_history h WHERE h.account_id=NEW.id AND h.revision=NEW.revision AND h.name=NEW.name AND h.kind=NEW.kind AND h.bean_path IS NEW.bean_path AND h.parent_id IS NEW.parent_id AND h.active=NEW.active) OR NOT (NEW.revision=OLD.revision+1 OR (NEW.revision=OLD.revision AND OLD.ever_used=0 AND NEW.ever_used=1 AND NEW.name IS OLD.name AND NEW.kind IS OLD.kind AND NEW.bean_path IS OLD.bean_path AND NEW.parent_id IS OLD.parent_id AND NEW.active=OLD.active))
  BEGIN SELECT RAISE(ABORT, 'finance_v2 account revision/history mismatch'); END;
CREATE TABLE finance_v2_vias (
  id TEXT NOT NULL PRIMARY KEY,
  revision INTEGER NOT NULL CHECK(revision >= 1),
  name TEXT NOT NULL,
  active INTEGER NOT NULL CHECK(active IN (0,1)),
  UNIQUE(id, revision),
  FOREIGN KEY(id, revision) REFERENCES finance_v2_via_history(via_id, revision)
    ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE finance_v2_via_history (
  via_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision >= 1),
  name TEXT NOT NULL,
  active INTEGER NOT NULL CHECK(active IN (0,1)),
  recorded_at_utc_us INTEGER NOT NULL,
  PRIMARY KEY(via_id, revision),
  FOREIGN KEY(via_id) REFERENCES finance_v2_vias(id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED
);
CREATE TRIGGER finance_v2_vias_insert_matches_history
  BEFORE INSERT ON finance_v2_vias
  WHEN NEW.revision <> 1 OR NOT EXISTS(SELECT 1 FROM finance_v2_via_history h WHERE h.via_id=NEW.id AND h.revision=NEW.revision AND h.name=NEW.name AND h.active=NEW.active)
  BEGIN SELECT RAISE(ABORT, 'finance_v2 via current/history mismatch'); END;
CREATE TRIGGER finance_v2_vias_update_matches_history
  BEFORE UPDATE ON finance_v2_vias
  WHEN NEW.id <> OLD.id OR NEW.revision <> OLD.revision + 1 OR NOT EXISTS(SELECT 1 FROM finance_v2_via_history h WHERE h.via_id=NEW.id AND h.revision=NEW.revision AND h.name=NEW.name AND h.active=NEW.active)
  BEGIN SELECT RAISE(ABORT, 'finance_v2 via revision/history mismatch'); END;
CREATE TABLE finance_v2_account_via_history (
  account_id TEXT NOT NULL,
  via_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision >= 1),
  active INTEGER NOT NULL CHECK(active IN (0,1)),
  recorded_at_utc_us INTEGER NOT NULL,
  PRIMARY KEY(account_id, via_id, revision),
  FOREIGN KEY(account_id) REFERENCES finance_v2_accounts(id) ON DELETE RESTRICT,
  FOREIGN KEY(via_id) REFERENCES finance_v2_vias(id) ON DELETE RESTRICT
);
CREATE TRIGGER finance_v2_account_via_revision_step
  BEFORE INSERT ON finance_v2_account_via_history
  WHEN NEW.revision <> COALESCE((SELECT MAX(revision)+1 FROM finance_v2_account_via_history WHERE account_id=NEW.account_id AND via_id=NEW.via_id),1)
  BEGIN SELECT RAISE(ABORT, 'finance_v2 account-via revision must advance by one'); END;
CREATE TABLE finance_v2_l0_versions (
  id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision >= 1),
  effective_date TEXT NOT NULL,
  business_time_kind TEXT NOT NULL CHECK(business_time_kind IN ('date','instant')),
  source_date TEXT,
  occurred_at_utc_us INTEGER,
  positive_account_id TEXT NOT NULL,
  positive_coefficient TEXT NOT NULL,
  positive_scale INTEGER NOT NULL CHECK(positive_scale BETWEEN 0 AND 9),
  positive_commodity TEXT NOT NULL,
  negative_account_id TEXT NOT NULL,
  negative_coefficient TEXT NOT NULL,
  negative_scale INTEGER NOT NULL CHECK(negative_scale BETWEEN 0 AND 9),
  negative_commodity TEXT NOT NULL,
  via_id TEXT,
  title TEXT NOT NULL,
  notes TEXT NOT NULL,
  provenance_kind TEXT NOT NULL CHECK(provenance_kind IN ('manual','imported')),
  provenance_payload TEXT NOT NULL,
  change_origin TEXT NOT NULL CHECK(change_origin IN ('created_manual','created_imported','manual_amend','deleted','restored','refined')),
  status TEXT NOT NULL CHECK(status IN ('active','deleted','refined')),
  recorded_at_utc_us INTEGER NOT NULL,
  PRIMARY KEY(id, revision),
  FOREIGN KEY(positive_account_id) REFERENCES finance_v2_accounts(id) ON DELETE RESTRICT,
  FOREIGN KEY(negative_account_id) REFERENCES finance_v2_accounts(id) ON DELETE RESTRICT,
  FOREIGN KEY(via_id) REFERENCES finance_v2_vias(id) ON DELETE RESTRICT,
  CHECK(positive_coefficient NOT GLOB '*[^0-9]*' AND positive_coefficient <> '' AND positive_coefficient NOT GLOB '0*'),
  CHECK(negative_coefficient NOT GLOB '*[^0-9]*' AND negative_coefficient <> '' AND negative_coefficient NOT GLOB '0*'),
  CHECK((positive_commodity <> negative_commodity) OR
        (positive_scale = negative_scale AND positive_coefficient = negative_coefficient)),
  CHECK(positive_account_id <> negative_account_id),
  CHECK((business_time_kind = 'date' AND occurred_at_utc_us IS NULL AND source_date = effective_date) OR
        (business_time_kind = 'instant' AND occurred_at_utc_us IS NOT NULL))
);
CREATE TABLE finance_v2_l0_current (
  id TEXT NOT NULL PRIMARY KEY,
  revision INTEGER NOT NULL,
  UNIQUE(id, revision),
  FOREIGN KEY(id, revision) REFERENCES finance_v2_l0_versions(id, revision) ON DELETE RESTRICT
);
CREATE TRIGGER finance_v2_l0_current_insert_step
  BEFORE INSERT ON finance_v2_l0_current
  WHEN NEW.revision <> 1
  BEGIN SELECT RAISE(ABORT, 'finance_v2 L0 current must start at revision 1'); END;
CREATE TRIGGER finance_v2_l0_current_update_step
  BEFORE UPDATE ON finance_v2_l0_current
  WHEN NEW.id <> OLD.id OR NEW.revision <> OLD.revision + 1
  BEGIN SELECT RAISE(ABORT, 'finance_v2 L0 current revision must advance by one'); END;
CREATE TABLE finance_v2_source_artifacts (
  id TEXT NOT NULL PRIMARY KEY,
  sha256 TEXT NOT NULL CHECK(length(sha256)=64 AND sha256 NOT GLOB '*[^0-9a-f]*'),
  byte_length INTEGER NOT NULL CHECK(byte_length >= 0),
  media_type TEXT NOT NULL,
  relative_path TEXT NOT NULL,
  source_context_id TEXT NOT NULL,
  source_context_revision INTEGER NOT NULL CHECK(source_context_revision >= 1),
  binding_revision INTEGER NOT NULL CHECK(binding_revision >= 0),
  created_at_utc_us INTEGER NOT NULL,
  UNIQUE(relative_path),
  FOREIGN KEY(source_context_id,source_context_revision) REFERENCES finance_v2_source_context_versions(id,revision) ON DELETE RESTRICT
);
CREATE TABLE finance_v2_source_binding_versions (
  id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision >= 1),
  source_context_id TEXT NOT NULL,
  source_context_revision INTEGER NOT NULL CHECK(source_context_revision >= 1),
  profile_id TEXT NOT NULL,
  profile_revision TEXT NOT NULL,
  field_alias TEXT NOT NULL,
  source_hint TEXT NOT NULL,
  account_id TEXT,
  via_id TEXT,
  active INTEGER NOT NULL CHECK(active IN (0,1)),
  recorded_at_utc_us INTEGER NOT NULL,
  PRIMARY KEY(id,revision),
  FOREIGN KEY(id) REFERENCES finance_v2_source_binding_current(id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY(source_context_id,source_context_revision) REFERENCES finance_v2_source_context_versions(id,revision) ON DELETE RESTRICT,
  FOREIGN KEY(account_id) REFERENCES finance_v2_accounts(id) ON DELETE RESTRICT,
  FOREIGN KEY(via_id) REFERENCES finance_v2_vias(id) ON DELETE RESTRICT,
  CHECK(account_id IS NOT NULL OR via_id IS NOT NULL)
);
CREATE TABLE finance_v2_source_binding_current (
  id TEXT NOT NULL PRIMARY KEY,
  revision INTEGER NOT NULL,
  UNIQUE(id,revision),
  FOREIGN KEY(id,revision) REFERENCES finance_v2_source_binding_versions(id,revision) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED
);
CREATE TRIGGER finance_v2_source_binding_current_insert_matches_version
  BEFORE INSERT ON finance_v2_source_binding_current
  WHEN NOT EXISTS(SELECT 1 FROM finance_v2_source_binding_versions v WHERE v.id=NEW.id AND v.revision=NEW.revision)
  BEGIN SELECT RAISE(ABORT, 'finance_v2 source binding pointer mismatch'); END;
CREATE TRIGGER finance_v2_source_binding_current_update_matches_version
  BEFORE UPDATE ON finance_v2_source_binding_current
  WHEN NEW.id <> OLD.id OR NEW.revision <> OLD.revision + 1 OR NOT EXISTS(SELECT 1 FROM finance_v2_source_binding_versions v WHERE v.id=NEW.id AND v.revision=NEW.revision)
  BEGIN SELECT RAISE(ABORT, 'finance_v2 source binding pointer mismatch'); END;
CREATE TABLE finance_v2_evidence (
  id TEXT NOT NULL PRIMARY KEY,
  artifact_id TEXT NOT NULL,
  locator TEXT NOT NULL,
  occurrence_discriminator TEXT NOT NULL,
  profile_id TEXT NOT NULL,
  profile_revision TEXT NOT NULL,
  raw_text_version INTEGER NOT NULL CHECK(raw_text_version >= 1),
  raw_text TEXT NOT NULL,
  created_at_utc_us INTEGER NOT NULL,
  UNIQUE(artifact_id, locator, occurrence_discriminator),
  FOREIGN KEY(artifact_id) REFERENCES finance_v2_source_artifacts(id) ON DELETE RESTRICT
);
CREATE TABLE finance_v2_evidence_link_history (
  id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision >= 1),
  evidence_id TEXT NOT NULL,
  observed_account_id TEXT NOT NULL,
  observation_role TEXT NOT NULL CHECK(length(trim(observation_role)) > 0),
  relation_kind TEXT NOT NULL CHECK(relation_kind IN ('ordinary','refinement','refund')),
  grouping_kind TEXT NOT NULL CHECK(grouping_kind IN ('ordinary','refinement')),
  group_id TEXT,
  leaf_l0_id TEXT,
  leaf_l0_revision INTEGER,
  status TEXT NOT NULL CHECK(status IN ('active','revoked')),
  allocation_payload TEXT,
  recorded_at_utc_us INTEGER NOT NULL,
  revocation_operation_id TEXT,
  PRIMARY KEY(id, revision),
  FOREIGN KEY(evidence_id) REFERENCES finance_v2_evidence(id) ON DELETE RESTRICT,
  FOREIGN KEY(observed_account_id) REFERENCES finance_v2_accounts(id) ON DELETE RESTRICT,
  FOREIGN KEY(leaf_l0_id, leaf_l0_revision) REFERENCES finance_v2_l0_versions(id, revision) ON DELETE RESTRICT,
  CHECK((leaf_l0_id IS NULL AND leaf_l0_revision IS NULL) OR
        (leaf_l0_id IS NOT NULL AND leaf_l0_revision IS NOT NULL)),
  CHECK((grouping_kind = 'ordinary' AND group_id IS NULL) OR
        (grouping_kind = 'refinement' AND group_id IS NOT NULL))
);
CREATE TABLE finance_v2_evidence_link_current (
  id TEXT NOT NULL PRIMARY KEY,
  revision INTEGER NOT NULL,
  evidence_id TEXT NOT NULL,
  observed_account_id TEXT NOT NULL,
  observation_role TEXT NOT NULL,
  relation_kind TEXT NOT NULL,
  grouping_kind TEXT NOT NULL,
  group_id TEXT,
  leaf_l0_id TEXT,
  leaf_l0_revision INTEGER,
  status TEXT NOT NULL CHECK(status IN ('active','revoked')),
  FOREIGN KEY(id, revision) REFERENCES finance_v2_evidence_link_history(id, revision) ON DELETE RESTRICT,
  FOREIGN KEY(evidence_id) REFERENCES finance_v2_evidence(id) ON DELETE RESTRICT,
  FOREIGN KEY(observed_account_id) REFERENCES finance_v2_accounts(id) ON DELETE RESTRICT,
  FOREIGN KEY(leaf_l0_id, leaf_l0_revision) REFERENCES finance_v2_l0_versions(id, revision) ON DELETE RESTRICT,
  CHECK((leaf_l0_id IS NULL AND leaf_l0_revision IS NULL) OR
        (leaf_l0_id IS NOT NULL AND leaf_l0_revision IS NOT NULL))
);
CREATE TRIGGER finance_v2_evidence_link_current_matches_history_insert
  BEFORE INSERT ON finance_v2_evidence_link_current
  WHEN NOT EXISTS(SELECT 1 FROM finance_v2_evidence_link_history h WHERE h.id=NEW.id AND h.revision=NEW.revision AND h.evidence_id=NEW.evidence_id AND h.observed_account_id=NEW.observed_account_id AND h.observation_role=NEW.observation_role AND h.relation_kind=NEW.relation_kind AND h.grouping_kind=NEW.grouping_kind AND h.group_id IS NEW.group_id AND h.leaf_l0_id IS NEW.leaf_l0_id AND h.leaf_l0_revision IS NEW.leaf_l0_revision AND h.status=NEW.status)
  BEGIN SELECT RAISE(ABORT, 'finance_v2 evidence link pointer mismatch'); END;
CREATE TRIGGER finance_v2_evidence_link_current_matches_history_update
  BEFORE UPDATE ON finance_v2_evidence_link_current
  WHEN NOT EXISTS(SELECT 1 FROM finance_v2_evidence_link_history h WHERE h.id=NEW.id AND h.revision=NEW.revision AND h.evidence_id=NEW.evidence_id AND h.observed_account_id=NEW.observed_account_id AND h.observation_role=NEW.observation_role AND h.relation_kind=NEW.relation_kind AND h.grouping_kind=NEW.grouping_kind AND h.group_id IS NEW.group_id AND h.leaf_l0_id IS NEW.leaf_l0_id AND h.leaf_l0_revision IS NEW.leaf_l0_revision AND h.status=NEW.status)
  BEGIN SELECT RAISE(ABORT, 'finance_v2 evidence link pointer mismatch'); END;
CREATE TRIGGER finance_v2_evidence_link_current_insert_step
  BEFORE INSERT ON finance_v2_evidence_link_current
  WHEN NEW.revision <> 1
  BEGIN SELECT RAISE(ABORT, 'finance_v2 evidence link must start at revision 1'); END;
CREATE TRIGGER finance_v2_evidence_link_current_update_step
  BEFORE UPDATE ON finance_v2_evidence_link_current
  WHEN NEW.id <> OLD.id OR NEW.revision <> OLD.revision + 1
  BEGIN SELECT RAISE(ABORT, 'finance_v2 evidence link revision must advance by one'); END;
CREATE TABLE finance_v2_treatment_versions (
  id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision >= 1),
  owner_l0_id TEXT NOT NULL,
  members_payload TEXT NOT NULL,
  merge_groups_payload TEXT NOT NULL,
  refund_edges_payload TEXT NOT NULL,
  title TEXT NOT NULL,
  notes TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('active','deleted')),
  recorded_at_utc_us INTEGER NOT NULL,
  PRIMARY KEY(id, revision),
  FOREIGN KEY(owner_l0_id) REFERENCES finance_v2_l0_current(id) ON DELETE RESTRICT
);
CREATE TABLE finance_v2_treatment_current (
  id TEXT NOT NULL PRIMARY KEY,
  revision INTEGER NOT NULL,
  FOREIGN KEY(id, revision) REFERENCES finance_v2_treatment_versions(id, revision) ON DELETE RESTRICT
);
CREATE TRIGGER finance_v2_treatment_current_insert_step
  BEFORE INSERT ON finance_v2_treatment_current
  WHEN NEW.revision <> 1
  BEGIN SELECT RAISE(ABORT, 'finance_v2 treatment current must start at revision 1'); END;
CREATE TRIGGER finance_v2_treatment_current_update_step
  BEFORE UPDATE ON finance_v2_treatment_current
  WHEN NEW.id <> OLD.id OR NEW.revision <> OLD.revision + 1
  BEGIN SELECT RAISE(ABORT, 'finance_v2 treatment current revision must advance by one'); END;
CREATE TABLE finance_v2_calibration_versions (
  id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision >= 1),
  account_id TEXT NOT NULL,
  business_date TEXT NOT NULL,
  coefficient TEXT NOT NULL,
  scale INTEGER NOT NULL CHECK(scale BETWEEN 0 AND 9),
  commodity TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('active','deleted')),
  recorded_at_utc_us INTEGER NOT NULL,
  PRIMARY KEY(id, revision),
  FOREIGN KEY(account_id) REFERENCES finance_v2_accounts(id) ON DELETE RESTRICT
);
CREATE TABLE finance_v2_calibration_current (
  id TEXT NOT NULL PRIMARY KEY,
  revision INTEGER NOT NULL,
  account_id TEXT NOT NULL,
  business_date TEXT NOT NULL,
  commodity TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('active','deleted')),
  FOREIGN KEY(id, revision) REFERENCES finance_v2_calibration_versions(id, revision) ON DELETE RESTRICT,
  FOREIGN KEY(account_id) REFERENCES finance_v2_accounts(id) ON DELETE RESTRICT
);
CREATE TRIGGER finance_v2_calibration_current_insert_matches_version
  BEFORE INSERT ON finance_v2_calibration_current
  WHEN NOT EXISTS(SELECT 1 FROM finance_v2_calibration_versions v WHERE v.id=NEW.id AND v.revision=NEW.revision AND v.account_id=NEW.account_id AND v.business_date=NEW.business_date AND v.commodity=NEW.commodity AND v.status=NEW.status)
  BEGIN SELECT RAISE(ABORT, 'finance_v2 calibration pointer mismatch'); END;
CREATE TRIGGER finance_v2_calibration_current_insert_step
  BEFORE INSERT ON finance_v2_calibration_current
  WHEN NEW.revision <> 1
  BEGIN SELECT RAISE(ABORT, 'finance_v2 calibration current must start at revision 1'); END;
CREATE TRIGGER finance_v2_calibration_current_update_matches_version
  BEFORE UPDATE ON finance_v2_calibration_current
  WHEN NEW.id <> OLD.id OR NEW.revision <> OLD.revision + 1 OR NOT EXISTS(SELECT 1 FROM finance_v2_calibration_versions v WHERE v.id=NEW.id AND v.revision=NEW.revision AND v.account_id=NEW.account_id AND v.business_date=NEW.business_date AND v.commodity=NEW.commodity AND v.status=NEW.status)
  BEGIN SELECT RAISE(ABORT, 'finance_v2 calibration pointer mismatch'); END;
CREATE UNIQUE INDEX finance_v2_calibration_current_active_unique
  ON finance_v2_calibration_current(account_id, business_date, commodity) WHERE status = 'active';
CREATE UNIQUE INDEX finance_v2_evidence_link_ordinary_leaf_unique
  ON finance_v2_evidence_link_current(evidence_id,observed_account_id,observation_role)
  WHERE relation_kind = 'ordinary' AND grouping_kind = 'ordinary' AND status = 'active' AND leaf_l0_id IS NOT NULL;
CREATE UNIQUE INDEX finance_v2_evidence_link_refinement_member_unique
  ON finance_v2_evidence_link_current(evidence_id,observed_account_id,observation_role,leaf_l0_id,leaf_l0_revision)
  WHERE relation_kind = 'refinement' AND grouping_kind = 'refinement' AND status = 'active';
CREATE UNIQUE INDEX finance_v2_evidence_link_refund_unique
  ON finance_v2_evidence_link_current(evidence_id,observed_account_id,observation_role)
  WHERE relation_kind = 'refund' AND status = 'active';
CREATE TABLE finance_v2_evidence_claim_current (
  evidence_id TEXT NOT NULL,
  observed_account_id TEXT NOT NULL,
  observation_role TEXT NOT NULL CHECK(length(trim(observation_role)) > 0),
  relation_kind TEXT NOT NULL CHECK(relation_kind IN ('ordinary','refinement','refund')),
  group_id TEXT,
  status TEXT NOT NULL CHECK(status IN ('active','released')),
  PRIMARY KEY(evidence_id,observed_account_id,observation_role),
  FOREIGN KEY(evidence_id) REFERENCES finance_v2_evidence(id) ON DELETE RESTRICT,
  FOREIGN KEY(observed_account_id) REFERENCES finance_v2_accounts(id) ON DELETE RESTRICT,
  CHECK((relation_kind='refinement' AND group_id IS NOT NULL) OR (relation_kind<>'refinement' AND group_id IS NULL))
);
CREATE TRIGGER finance_v2_evidence_no_update BEFORE UPDATE ON finance_v2_evidence
  BEGIN SELECT RAISE(ABORT, 'finance_v2 evidence is immutable'); END;
CREATE TRIGGER finance_v2_evidence_no_delete BEFORE DELETE ON finance_v2_evidence
  BEGIN SELECT RAISE(ABORT, 'finance_v2 evidence is immutable'); END;
CREATE TRIGGER finance_v2_binding_current_insert_step
  BEFORE INSERT ON finance_v2_source_binding_current
  WHEN NEW.revision <> 1
  BEGIN SELECT RAISE(ABORT, 'finance_v2 binding current must start at revision 1'); END;
CREATE TRIGGER finance_v2_binding_current_update_step
  BEFORE UPDATE ON finance_v2_source_binding_current
  WHEN NEW.id <> OLD.id OR NEW.revision <> OLD.revision + 1
  BEGIN SELECT RAISE(ABORT, 'finance_v2 binding current revision must advance by one'); END;
CREATE TRIGGER finance_v2_l0_versions_no_update BEFORE UPDATE ON finance_v2_l0_versions
  BEGIN SELECT RAISE(ABORT, 'finance_v2 L0 versions are immutable'); END;
CREATE TRIGGER finance_v2_l0_versions_no_delete BEFORE DELETE ON finance_v2_l0_versions
  BEGIN SELECT RAISE(ABORT, 'finance_v2 L0 versions are immutable'); END;
CREATE TRIGGER finance_v2_source_artifact_no_update BEFORE UPDATE ON finance_v2_source_artifacts
  BEGIN SELECT RAISE(ABORT, 'finance_v2 source artifact identity is immutable'); END;
CREATE TRIGGER finance_v2_source_artifact_no_delete BEFORE DELETE ON finance_v2_source_artifacts
  BEGIN SELECT RAISE(ABORT, 'finance_v2 source artifact identity is immutable'); END;
CREATE TRIGGER finance_v2_source_binding_versions_no_update BEFORE UPDATE ON finance_v2_source_binding_versions
  BEGIN SELECT RAISE(ABORT, 'finance_v2 source binding versions are immutable'); END;
CREATE TRIGGER finance_v2_source_binding_versions_no_delete BEFORE DELETE ON finance_v2_source_binding_versions
  BEGIN SELECT RAISE(ABORT, 'finance_v2 source binding versions are immutable'); END;
CREATE TRIGGER finance_v2_account_history_no_update BEFORE UPDATE ON finance_v2_account_history
  BEGIN SELECT RAISE(ABORT, 'finance_v2 account history is immutable'); END;
CREATE TRIGGER finance_v2_account_history_no_delete BEFORE DELETE ON finance_v2_account_history
  BEGIN SELECT RAISE(ABORT, 'finance_v2 account history is immutable'); END;
CREATE TRIGGER finance_v2_via_history_no_update BEFORE UPDATE ON finance_v2_via_history
  BEGIN SELECT RAISE(ABORT, 'finance_v2 via history is immutable'); END;
CREATE TRIGGER finance_v2_via_history_no_delete BEFORE DELETE ON finance_v2_via_history
  BEGIN SELECT RAISE(ABORT, 'finance_v2 via history is immutable'); END;
CREATE TRIGGER finance_v2_account_via_no_update BEFORE UPDATE ON finance_v2_account_via_history
  BEGIN SELECT RAISE(ABORT, 'finance_v2 account via history is immutable'); END;
CREATE TRIGGER finance_v2_account_via_no_delete BEFORE DELETE ON finance_v2_account_via_history
  BEGIN SELECT RAISE(ABORT, 'finance_v2 account via history is immutable'); END;
CREATE TRIGGER finance_v2_account_kind_locked BEFORE UPDATE OF kind ON finance_v2_accounts
  WHEN OLD.kind <> NEW.kind AND EXISTS(
    SELECT 1 FROM finance_v2_l0_versions WHERE positive_account_id=OLD.id OR negative_account_id=OLD.id
  )
  BEGIN SELECT RAISE(ABORT, 'finance_v2 account kind is immutable after use'); END;
CREATE TRIGGER finance_v2_evidence_link_no_update BEFORE UPDATE ON finance_v2_evidence_link_history
  BEGIN SELECT RAISE(ABORT, 'finance_v2 evidence links are immutable'); END;
CREATE TRIGGER finance_v2_evidence_link_no_delete BEFORE DELETE ON finance_v2_evidence_link_history
  BEGIN SELECT RAISE(ABORT, 'finance_v2 evidence links are immutable'); END;
CREATE TRIGGER finance_v2_treatment_no_update BEFORE UPDATE ON finance_v2_treatment_versions
  BEGIN SELECT RAISE(ABORT, 'finance_v2 treatment versions are immutable'); END;
CREATE TRIGGER finance_v2_treatment_no_delete BEFORE DELETE ON finance_v2_treatment_versions
  BEGIN SELECT RAISE(ABORT, 'finance_v2 treatment versions are immutable'); END;
CREATE TRIGGER finance_v2_calibration_no_update BEFORE UPDATE ON finance_v2_calibration_versions
  BEGIN SELECT RAISE(ABORT, 'finance_v2 calibration versions are immutable'); END;
CREATE TRIGGER finance_v2_calibration_no_delete BEFORE DELETE ON finance_v2_calibration_versions
  BEGIN SELECT RAISE(ABORT, 'finance_v2 calibration versions are immutable'); END;
CREATE TABLE finance_v2_rules_history (
  revision INTEGER NOT NULL PRIMARY KEY CHECK(revision >= 0), content TEXT NOT NULL,
  sha256 TEXT NOT NULL CHECK(length(sha256)=64 AND sha256 NOT GLOB '*[^0-9a-f]*'), recorded_at_utc_us INTEGER NOT NULL,
  UNIQUE(revision,content,sha256)
);
INSERT INTO finance_v2_rules_history(revision,content,sha256,recorded_at_utc_us) VALUES (0,'','e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',0);
CREATE TABLE finance_v2_rules_current (
  singleton INTEGER NOT NULL PRIMARY KEY CHECK(singleton=1), revision INTEGER NOT NULL, content TEXT NOT NULL, sha256 TEXT NOT NULL,
  FOREIGN KEY(revision,content,sha256) REFERENCES finance_v2_rules_history(revision,content,sha256) ON DELETE RESTRICT
);
INSERT INTO finance_v2_rules_current(singleton,revision,content,sha256) VALUES (1,0,'','e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
CREATE TRIGGER finance_v2_rules_current_insert_matches BEFORE INSERT ON finance_v2_rules_current WHEN NEW.singleton<>1 OR NOT EXISTS(SELECT 1 FROM finance_v2_rules_history h WHERE h.revision=NEW.revision AND h.content=NEW.content AND h.sha256=NEW.sha256) BEGIN SELECT RAISE(ABORT,'finance_v2 rules pointer mismatch'); END;
CREATE TRIGGER finance_v2_rules_current_update_matches BEFORE UPDATE ON finance_v2_rules_current WHEN NEW.singleton<>OLD.singleton OR NEW.revision<>OLD.revision+1 OR NOT EXISTS(SELECT 1 FROM finance_v2_rules_history h WHERE h.revision=NEW.revision AND h.content=NEW.content AND h.sha256=NEW.sha256) BEGIN SELECT RAISE(ABORT,'finance_v2 rules pointer mismatch'); END;
CREATE TRIGGER finance_v2_rules_current_no_delete BEFORE DELETE ON finance_v2_rules_current BEGIN SELECT RAISE(ABORT,'finance_v2 rules current row is required'); END;
CREATE TRIGGER finance_v2_rules_history_no_update BEFORE UPDATE ON finance_v2_rules_history BEGIN SELECT RAISE(ABORT,'finance_v2 rules history immutable'); END;
CREATE TRIGGER finance_v2_rules_history_no_delete BEFORE DELETE ON finance_v2_rules_history BEGIN SELECT RAISE(ABORT,'finance_v2 rules history immutable'); END;
CREATE TABLE finance_v2_ai_model_history (
  revision INTEGER NOT NULL PRIMARY KEY CHECK(revision>=0), model_id TEXT NOT NULL, recorded_at_utc_us INTEGER NOT NULL,
  UNIQUE(revision,model_id)
);
INSERT INTO finance_v2_ai_model_history(revision,model_id,recorded_at_utc_us) VALUES (0,'',0);
CREATE TABLE finance_v2_ai_model_current (
  singleton INTEGER NOT NULL PRIMARY KEY CHECK(singleton=1), revision INTEGER NOT NULL, model_id TEXT NOT NULL,
  FOREIGN KEY(revision,model_id) REFERENCES finance_v2_ai_model_history(revision,model_id) ON DELETE RESTRICT
);
INSERT INTO finance_v2_ai_model_current(singleton,revision,model_id) VALUES (1,0,'');
CREATE TRIGGER finance_v2_ai_model_current_insert_matches BEFORE INSERT ON finance_v2_ai_model_current WHEN NEW.singleton<>1 OR NOT EXISTS(SELECT 1 FROM finance_v2_ai_model_history h WHERE h.revision=NEW.revision AND h.model_id=NEW.model_id) BEGIN SELECT RAISE(ABORT,'finance_v2 model pointer mismatch'); END;
CREATE TRIGGER finance_v2_ai_model_current_update_matches BEFORE UPDATE ON finance_v2_ai_model_current WHEN NEW.singleton<>OLD.singleton OR NEW.revision<>OLD.revision+1 OR NOT EXISTS(SELECT 1 FROM finance_v2_ai_model_history h WHERE h.revision=NEW.revision AND h.model_id=NEW.model_id) BEGIN SELECT RAISE(ABORT,'finance_v2 model pointer mismatch'); END;
CREATE TRIGGER finance_v2_ai_model_current_no_delete BEFORE DELETE ON finance_v2_ai_model_current BEGIN SELECT RAISE(ABORT,'finance_v2 model current row is required'); END;
CREATE TRIGGER finance_v2_ai_model_history_no_update BEFORE UPDATE ON finance_v2_ai_model_history BEGIN SELECT RAISE(ABORT,'finance_v2 model history immutable'); END;
CREATE TRIGGER finance_v2_ai_model_history_no_delete BEFORE DELETE ON finance_v2_ai_model_history BEGIN SELECT RAISE(ABORT,'finance_v2 model history immutable'); END;
"#;

const TABLES: &[&str] = &[
    "finance_v2_meta", "finance_v2_ledger_state", "finance_v2_commit_receipts", "finance_v2_materialization_jobs", "finance_v2_l0_change_audit", "finance_v2_treatment_change_audit", "finance_v2_binding_state", "finance_v2_source_context_state", "finance_v2_source_context_current", "finance_v2_source_context_versions", "finance_v2_account_via_state", "finance_v2_accounts", "finance_v2_account_history",
    "finance_v2_vias", "finance_v2_via_history", "finance_v2_account_via_history",
    "finance_v2_l0_versions", "finance_v2_l0_current", "finance_v2_source_artifacts",
    "finance_v2_source_binding_versions", "finance_v2_source_binding_current", "finance_v2_evidence",
    "finance_v2_evidence_link_history", "finance_v2_evidence_link_current", "finance_v2_evidence_claim_current", "finance_v2_treatment_versions",
    "finance_v2_treatment_current", "finance_v2_calibration_versions",
    "finance_v2_calibration_current", "finance_v2_rules_history", "finance_v2_rules_current", "finance_v2_ai_model_history", "finance_v2_ai_model_current",
];

const COLUMNS: &[(&str, &[&str])] = &[
    ("finance_v2_meta", &["schema_version"]),
    ("finance_v2_ledger_state", &["singleton","generation"]),
    ("finance_v2_commit_receipts", &["operation_id","receipt_id","payload_sha256","committed_generation","id_map_json","committed_at_utc_us"]),
    ("finance_v2_materialization_jobs", &["job_id","operation_id","generation","status","input_sha256","output_sha256","error_code","error_detail","created_at_utc_us","updated_at_utc_us"]),
    ("finance_v2_l0_change_audit", &["fact_id","revision","operation_id","changed_at_utc_us","reason"]),
    ("finance_v2_treatment_change_audit", &["treatment_id","revision","operation_id","changed_at_utc_us","reason"]),
    ("finance_v2_binding_state", &["singleton","revision"]),
    ("finance_v2_source_context_state", &["singleton","revision"]),
    ("finance_v2_source_context_current", &["id","revision"]),
    ("finance_v2_source_context_versions", &["id","revision","label","provider","scope","date_semantics","active","recorded_at_utc_us"]),
    ("finance_v2_account_via_state", &["singleton","revision"]),
    ("finance_v2_accounts", &["id","revision","name","kind","bean_path","parent_id","active","ever_used"]),
    ("finance_v2_account_history", &["account_id","revision","name","kind","bean_path","parent_id","active","recorded_at_utc_us"]),
    ("finance_v2_vias", &["id","revision","name","active"]),
    ("finance_v2_via_history", &["via_id","revision","name","active","recorded_at_utc_us"]),
    ("finance_v2_account_via_history", &["account_id","via_id","revision","active","recorded_at_utc_us"]),
    ("finance_v2_l0_versions", &["id","revision","effective_date","business_time_kind","source_date","occurred_at_utc_us","positive_account_id","positive_coefficient","positive_scale","positive_commodity","negative_account_id","negative_coefficient","negative_scale","negative_commodity","via_id","title","notes","provenance_kind","provenance_payload","change_origin","status","recorded_at_utc_us"]),
    ("finance_v2_l0_current", &["id","revision"]),
    ("finance_v2_source_artifacts", &["id","sha256","byte_length","media_type","relative_path","source_context_id","source_context_revision","binding_revision","created_at_utc_us"]),
    ("finance_v2_source_binding_versions", &["id","revision","source_context_id","source_context_revision","profile_id","profile_revision","field_alias","source_hint","account_id","via_id","active","recorded_at_utc_us"]),
    ("finance_v2_source_binding_current", &["id","revision"]),
    ("finance_v2_evidence", &["id","artifact_id","locator","occurrence_discriminator","profile_id","profile_revision","raw_text_version","raw_text","created_at_utc_us"]),
    ("finance_v2_evidence_link_history", &["id","revision","evidence_id","observed_account_id","observation_role","relation_kind","grouping_kind","group_id","leaf_l0_id","leaf_l0_revision","status","allocation_payload","recorded_at_utc_us","revocation_operation_id"]),
    ("finance_v2_evidence_link_current", &["id","revision","evidence_id","observed_account_id","observation_role","relation_kind","grouping_kind","group_id","leaf_l0_id","leaf_l0_revision","status"]),
    ("finance_v2_evidence_claim_current", &["evidence_id","observed_account_id","observation_role","relation_kind","group_id","status"]),
    ("finance_v2_treatment_versions", &["id","revision","owner_l0_id","members_payload","merge_groups_payload","refund_edges_payload","title","notes","status","recorded_at_utc_us"]),
    ("finance_v2_treatment_current", &["id","revision"]),
    ("finance_v2_calibration_versions", &["id","revision","account_id","business_date","coefficient","scale","commodity","status","recorded_at_utc_us"]),
    ("finance_v2_calibration_current", &["id","revision","account_id","business_date","commodity","status"]),
    ("finance_v2_rules_history", &["revision","content","sha256","recorded_at_utc_us"]),
    ("finance_v2_rules_current", &["singleton","revision","content","sha256"]),
    ("finance_v2_ai_model_history", &["revision","model_id","recorded_at_utc_us"]),
    ("finance_v2_ai_model_current", &["singleton","revision","model_id"]),
];

const FOREIGN_KEYS: &[(&str,&str,&[&str],&[&str])] = &[
    ("finance_v2_materialization_jobs","finance_v2_commit_receipts",&["operation_id"],&["operation_id"]),
    ("finance_v2_l0_change_audit","finance_v2_l0_versions",&["fact_id","revision"],&["id","revision"]),
    ("finance_v2_treatment_change_audit","finance_v2_treatment_versions",&["treatment_id","revision"],&["id","revision"]),
    ("finance_v2_accounts","finance_v2_account_history",&["id","revision"],&["account_id","revision"]),
    ("finance_v2_accounts","finance_v2_accounts",&["parent_id"],&["id"]),
    ("finance_v2_account_history","finance_v2_accounts",&["account_id"],&["id"]),
    ("finance_v2_account_history","finance_v2_accounts",&["parent_id"],&["id"]),
    ("finance_v2_vias","finance_v2_via_history",&["id","revision"],&["via_id","revision"]),
    ("finance_v2_via_history","finance_v2_vias",&["via_id"],&["id"]),
    ("finance_v2_account_via_history","finance_v2_accounts",&["account_id"],&["id"]),
    ("finance_v2_account_via_history","finance_v2_vias",&["via_id"],&["id"]),
    ("finance_v2_l0_versions","finance_v2_accounts",&["positive_account_id"],&["id"]),
    ("finance_v2_l0_versions","finance_v2_accounts",&["negative_account_id"],&["id"]),
    ("finance_v2_l0_versions","finance_v2_vias",&["via_id"],&["id"]),
    ("finance_v2_l0_current","finance_v2_l0_versions",&["id","revision"],&["id","revision"]),
    ("finance_v2_source_binding_versions","finance_v2_source_binding_current",&["id"],&["id"]),
    ("finance_v2_source_context_versions","finance_v2_source_context_current",&["id"],&["id"]),
    ("finance_v2_source_context_current","finance_v2_source_context_versions",&["id","revision"],&["id","revision"]),
    ("finance_v2_source_artifacts","finance_v2_source_context_versions",&["source_context_id","source_context_revision"],&["id","revision"]),
    ("finance_v2_source_binding_versions","finance_v2_source_context_versions",&["source_context_id","source_context_revision"],&["id","revision"]),
    ("finance_v2_source_binding_versions","finance_v2_accounts",&["account_id"],&["id"]),
    ("finance_v2_source_binding_versions","finance_v2_vias",&["via_id"],&["id"]),
    ("finance_v2_source_binding_current","finance_v2_source_binding_versions",&["id","revision"],&["id","revision"]),
    ("finance_v2_evidence","finance_v2_source_artifacts",&["artifact_id"],&["id"]),
    ("finance_v2_evidence_link_history","finance_v2_evidence",&["evidence_id"],&["id"]),
    ("finance_v2_evidence_link_history","finance_v2_accounts",&["observed_account_id"],&["id"]),
    ("finance_v2_evidence_link_history","finance_v2_l0_versions",&["leaf_l0_id","leaf_l0_revision"],&["id","revision"]),
    ("finance_v2_evidence_link_current","finance_v2_evidence_link_history",&["id","revision"],&["id","revision"]),
    ("finance_v2_evidence_link_current","finance_v2_evidence",&["evidence_id"],&["id"]),
    ("finance_v2_evidence_link_current","finance_v2_accounts",&["observed_account_id"],&["id"]),
    ("finance_v2_evidence_link_current","finance_v2_l0_versions",&["leaf_l0_id","leaf_l0_revision"],&["id","revision"]),
    ("finance_v2_evidence_claim_current","finance_v2_evidence",&["evidence_id"],&["id"]),
    ("finance_v2_evidence_claim_current","finance_v2_accounts",&["observed_account_id"],&["id"]),
    ("finance_v2_treatment_versions","finance_v2_l0_current",&["owner_l0_id"],&["id"]),
    ("finance_v2_treatment_current","finance_v2_treatment_versions",&["id","revision"],&["id","revision"]),
    ("finance_v2_calibration_versions","finance_v2_accounts",&["account_id"],&["id"]),
    ("finance_v2_calibration_current","finance_v2_calibration_versions",&["id","revision"],&["id","revision"]),
    ("finance_v2_calibration_current","finance_v2_accounts",&["account_id"],&["id"]),
    ("finance_v2_rules_current","finance_v2_rules_history",&["revision","content","sha256"],&["revision","content","sha256"]),
    ("finance_v2_ai_model_current","finance_v2_ai_model_history",&["revision","model_id"],&["revision","model_id"]),
];

const INDEXES: &[(&str, &str)] = &[
    ("finance_v2_calibration_current_active_unique", "finance_v2_calibration_current"),
    ("finance_v2_evidence_link_ordinary_leaf_unique", "finance_v2_evidence_link_current"),
    ("finance_v2_evidence_link_refinement_member_unique", "finance_v2_evidence_link_current"),
    ("finance_v2_evidence_link_refund_unique", "finance_v2_evidence_link_current"),
];

const TRIGGER_TARGETS: &[(&str, &str)] = &[
    ("finance_v2_commit_receipts_no_update", "finance_v2_commit_receipts"), ("finance_v2_commit_receipts_no_delete", "finance_v2_commit_receipts"),
    ("finance_v2_l0_change_audit_no_update", "finance_v2_l0_change_audit"), ("finance_v2_l0_change_audit_no_delete", "finance_v2_l0_change_audit"),
    ("finance_v2_treatment_change_audit_no_update", "finance_v2_treatment_change_audit"), ("finance_v2_treatment_change_audit_no_delete", "finance_v2_treatment_change_audit"),
    ("finance_v2_evidence_no_update", "finance_v2_evidence"), ("finance_v2_evidence_no_delete", "finance_v2_evidence"),
    ("finance_v2_source_artifact_no_update", "finance_v2_source_artifacts"), ("finance_v2_source_artifact_no_delete", "finance_v2_source_artifacts"),
    ("finance_v2_source_binding_versions_no_update", "finance_v2_source_binding_versions"), ("finance_v2_source_binding_versions_no_delete", "finance_v2_source_binding_versions"),
    ("finance_v2_source_binding_current_insert_matches_version", "finance_v2_source_binding_current"), ("finance_v2_source_binding_current_update_matches_version", "finance_v2_source_binding_current"),
    ("finance_v2_source_context_current_insert_matches_version", "finance_v2_source_context_current"), ("finance_v2_source_context_current_update_matches_version", "finance_v2_source_context_current"),
    ("finance_v2_source_context_current_insert_step", "finance_v2_source_context_current"), ("finance_v2_source_context_current_update_step", "finance_v2_source_context_current"),
    ("finance_v2_source_context_versions_no_update", "finance_v2_source_context_versions"), ("finance_v2_source_context_versions_no_delete", "finance_v2_source_context_versions"),
    ("finance_v2_binding_current_insert_step", "finance_v2_source_binding_current"), ("finance_v2_binding_current_update_step", "finance_v2_source_binding_current"),
    ("finance_v2_accounts_insert_matches_history", "finance_v2_accounts"), ("finance_v2_accounts_update_matches_history", "finance_v2_accounts"),
    ("finance_v2_vias_insert_matches_history", "finance_v2_vias"), ("finance_v2_vias_update_matches_history", "finance_v2_vias"),
    ("finance_v2_l0_current_insert_step", "finance_v2_l0_current"), ("finance_v2_l0_current_update_step", "finance_v2_l0_current"),
    ("finance_v2_treatment_current_insert_step", "finance_v2_treatment_current"), ("finance_v2_treatment_current_update_step", "finance_v2_treatment_current"),
    ("finance_v2_calibration_current_insert_matches_version", "finance_v2_calibration_current"), ("finance_v2_calibration_current_update_matches_version", "finance_v2_calibration_current"),
    ("finance_v2_calibration_current_insert_step", "finance_v2_calibration_current"),
    ("finance_v2_evidence_link_current_matches_history_insert", "finance_v2_evidence_link_current"), ("finance_v2_evidence_link_current_matches_history_update", "finance_v2_evidence_link_current"),
    ("finance_v2_evidence_link_current_insert_step", "finance_v2_evidence_link_current"), ("finance_v2_evidence_link_current_update_step", "finance_v2_evidence_link_current"),
    ("finance_v2_account_via_revision_step", "finance_v2_account_via_history"),
    ("finance_v2_l0_versions_no_update", "finance_v2_l0_versions"), ("finance_v2_l0_versions_no_delete", "finance_v2_l0_versions"),
    ("finance_v2_account_history_no_update", "finance_v2_account_history"), ("finance_v2_account_history_no_delete", "finance_v2_account_history"),
    ("finance_v2_via_history_no_update", "finance_v2_via_history"), ("finance_v2_via_history_no_delete", "finance_v2_via_history"),
    ("finance_v2_account_via_no_update", "finance_v2_account_via_history"), ("finance_v2_account_via_no_delete", "finance_v2_account_via_history"),
    ("finance_v2_account_kind_locked", "finance_v2_accounts"),
    ("finance_v2_evidence_link_no_update", "finance_v2_evidence_link_history"), ("finance_v2_evidence_link_no_delete", "finance_v2_evidence_link_history"),
    ("finance_v2_treatment_no_update", "finance_v2_treatment_versions"), ("finance_v2_treatment_no_delete", "finance_v2_treatment_versions"),
    ("finance_v2_calibration_no_update", "finance_v2_calibration_versions"), ("finance_v2_calibration_no_delete", "finance_v2_calibration_versions"),
    ("finance_v2_rules_current_insert_matches","finance_v2_rules_current"),("finance_v2_rules_current_update_matches","finance_v2_rules_current"),("finance_v2_rules_current_no_delete","finance_v2_rules_current"),("finance_v2_rules_history_no_update","finance_v2_rules_history"),("finance_v2_rules_history_no_delete","finance_v2_rules_history"),
    ("finance_v2_ai_model_current_insert_matches","finance_v2_ai_model_current"),("finance_v2_ai_model_current_update_matches","finance_v2_ai_model_current"),("finance_v2_ai_model_current_no_delete","finance_v2_ai_model_current"),("finance_v2_ai_model_history_no_update","finance_v2_ai_model_history"),("finance_v2_ai_model_history_no_delete","finance_v2_ai_model_history"),
];

/// Installs into the caller's isolated connection and transaction only.
pub fn install(tx: &Transaction<'_>) -> Result<(), StoreError> {
    let foreign_keys_enabled: i64 = tx.query_row("PRAGMA foreign_keys", [], |row| row.get(0))?;
    if foreign_keys_enabled != 1 {
        return Err(StoreError::ForeignKeysDisabled);
    }
    let present = count_objects(tx, "table")?;
    if present == 0 {
        tx.execute_batch(DDL)?;
        tx.execute("INSERT INTO finance_v2_meta(schema_version) VALUES (?1)", [SCHEMA_VERSION])?;
        return Ok(());
    }
    validate(tx)
}

pub fn validate(connection: &Connection) -> Result<(), StoreError> {
    let foreign_keys:i64=connection.query_row("PRAGMA foreign_keys",[],|r|r.get(0))?;
    if foreign_keys != 1 { return Err(StoreError::ForeignKeysDisabled); }
    let table_count = count_objects(connection, "table")?;
    if table_count != TABLES.len() as i64 {
        return Err(StoreError::IncompatibleSchema);
    }
    for table in TABLES {
        let exists: bool = connection.query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name=?1)",
            [table],
            |row| row.get(0),
        )?;
        if !exists {
            return Err(StoreError::IncompatibleSchema);
        }
    }
    let supported=expected_schema_objects()?.into_iter().map(|(name,_)|name).collect::<std::collections::HashSet<_>>();
    let mut actual=std::collections::HashSet::new();
    {
        let mut stmt=connection.prepare("SELECT name FROM sqlite_master WHERE type IN ('table','index','trigger') AND name NOT LIKE 'sqlite_%' AND (type<>'index' OR sql IS NOT NULL)")?;
        let rows=stmt.query_map([],|r|r.get::<_,String>(0))?;
        for row in rows{actual.insert(row?);}
    }
    if actual!=supported{return Err(StoreError::IncompatibleSchema)}
    for (table,expected_columns) in COLUMNS {
        let mut stmt=connection.prepare(&format!("PRAGMA table_info({table})"))?;
        let columns=stmt.query_map([],|r|r.get::<_,String>(1))?.collect::<Result<Vec<_>,_>>()?;
        if columns.len()!=expected_columns.len() || columns.iter().zip(*expected_columns).any(|(actual,expected)|actual.as_str()!=*expected) { return Err(StoreError::IncompatibleSchema); }
    }
    for (name,expected_sql) in expected_schema_objects()? {
        let actual:Option<String>=connection.query_row("SELECT sql FROM sqlite_master WHERE name=?1",[&name],|r|r.get(0)).optional()?;
        let Some(actual)=actual else{return Err(StoreError::IncompatibleSchema)};
        if normalize_sql(&actual)!=expected_sql{return Err(StoreError::IncompatibleSchema)}
    }
    for (child,parent,from_columns,to_columns) in FOREIGN_KEYS {
        let mut stmt=connection.prepare(&format!("PRAGMA foreign_key_list({child})"))?;
        let rows=stmt.query_map([],|r|Ok((r.get::<_,i64>(0)?,r.get::<_,i64>(1)?,r.get::<_,String>(2)?,r.get::<_,String>(3)?,r.get::<_,String>(4)?,r.get::<_,String>(6)?)))?;
        let mut groups:std::collections::HashMap<i64,(String,String,Vec<(i64,String,String)>)>=std::collections::HashMap::new();
        for row in rows { let (id,seq,table,from,to,on_delete)=row?; let entry=groups.entry(id).or_insert_with(||(table.clone(),on_delete.clone(),Vec::new())); if entry.0!=table || entry.1!=on_delete{return Err(StoreError::IncompatibleSchema)} entry.2.push((seq,from,to)); }
        let found=groups.values_mut().any(|(table,on_delete,columns)|{columns.sort_by_key(|v|v.0);table.as_str()==*parent && on_delete=="RESTRICT" && columns.iter().map(|v|v.1.as_str()).eq(from_columns.iter().copied()) && columns.iter().map(|v|v.2.as_str()).eq(to_columns.iter().copied())});
        if !found{return Err(StoreError::IncompatibleSchema)}
    }
    let version: i64 = connection.query_row(
        "SELECT schema_version FROM finance_v2_meta",
        [],
        |row| row.get(0),
    ).map_err(|_| StoreError::IncompatibleSchema)?;
    if version != SCHEMA_VERSION {
        return Err(StoreError::UnsupportedSchemaVersion);
    }
    let trigger_count:i64=connection.query_row("SELECT COUNT(*) FROM sqlite_master WHERE type='trigger' AND substr(name,1,11)='finance_v2_'",[],|r|r.get(0))?;
    if trigger_count != TRIGGER_TARGETS.len() as i64 { return Err(StoreError::IncompatibleSchema); }
    for (trigger, expected_table) in TRIGGER_TARGETS {
        let actual: Option<(String, String)> = connection.query_row(
            "SELECT tbl_name,sql FROM sqlite_master WHERE type='trigger' AND name=?1",
            [trigger], |row| Ok((row.get(0)?,row.get(1)?)),
        ).optional()?;
        let Some((table, sql)) = actual else {
            return Err(StoreError::IncompatibleSchema);
        };
        let upper=sql.to_ascii_uppercase();
        let expected_action=if trigger.contains("_no_update") || trigger.ends_with("_update") || trigger.contains("_update_") || *trigger=="finance_v2_account_kind_locked" {"BEFORE UPDATE"} else if trigger.contains("_no_delete") {"BEFORE DELETE"} else {"BEFORE INSERT"};
        if table != *expected_table || !upper.contains(expected_action) || !upper.contains("RAISE(ABORT") {
            return Err(StoreError::IncompatibleSchema);
        }
    }
    let settings_rows:i64=connection.query_row("SELECT (SELECT COUNT(*) FROM finance_v2_rules_current WHERE singleton=1)+(SELECT COUNT(*) FROM finance_v2_ai_model_current WHERE singleton=1)",[],|r|r.get(0))?;
    if settings_rows!=2{return Err(StoreError::IncompatibleSchema)}
    let index_count:i64=connection.query_row("SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND substr(name,1,11)='finance_v2_'",[],|r|r.get(0))?;
    if index_count != INDEXES.len() as i64 { return Err(StoreError::IncompatibleSchema); }
    for (index, expected_table) in INDEXES {
        let actual: Option<(String,String)> = connection.query_row("SELECT tbl_name,sql FROM sqlite_master WHERE type='index' AND name=?1",[index],|r|Ok((r.get(0)?,r.get(1)?))).optional()?;
        let Some((table,sql))=actual else{return Err(StoreError::IncompatibleSchema)};
        if table != *expected_table || !sql.to_ascii_uppercase().contains("CREATE UNIQUE INDEX") {return Err(StoreError::IncompatibleSchema)}
    }
    Ok(())
}

/// Structure-only diagnostics for the opt-in integration seam. This reports
/// schema object names and metadata, never row contents or filesystem paths.
#[cfg(feature = "finance-v2-test-support")]
pub fn validation_diagnostics(connection: &Connection) -> Result<Vec<String>, StoreError> {
    use std::collections::{HashMap, HashSet};

    let mut issues = Vec::new();
    let foreign_keys: i64 = connection.query_row("PRAGMA foreign_keys", [], |r| r.get(0))?;
    if foreign_keys != 1 { issues.push(format!("foreign_keys expected=1 actual={foreign_keys}")); }

    let table_count = count_objects(connection, "table")?;
    if table_count != TABLES.len() as i64 { issues.push(format!("table_count expected={} actual={table_count}", TABLES.len())); }

    let expected_objects: HashMap<String, String> = expected_schema_objects()?.into_iter().collect();
    let expected_names: HashSet<&str> = expected_objects.keys().map(String::as_str).collect();
    let mut actual_names = HashSet::new();
    {
        let mut stmt = connection.prepare("SELECT name FROM sqlite_master WHERE type IN ('table','index','trigger') AND name NOT LIKE 'sqlite_%' AND (type<>'index' OR sql IS NOT NULL)")?;
        for name in stmt.query_map([], |r| r.get::<_, String>(0))? { actual_names.insert(name?); }
    }
    let actual_name_refs: HashSet<&str> = actual_names.iter().map(String::as_str).collect();
    let missing = expected_names.difference(&actual_name_refs).copied().collect::<Vec<_>>();
    let unexpected = actual_name_refs.difference(&expected_names).copied().collect::<Vec<_>>();
    if !missing.is_empty() || !unexpected.is_empty() { issues.push(format!("schema_objects missing={missing:?} unexpected={unexpected:?}")); }

    for (table, expected_columns) in COLUMNS {
        let mut stmt = connection.prepare(&format!("PRAGMA table_info({table})"))?;
        let columns = stmt.query_map([], |r| r.get::<_, String>(1))?.collect::<Result<Vec<_>, _>>()?;
        if columns.len() != expected_columns.len() || columns.iter().zip(*expected_columns).any(|(actual,expected)| actual.as_str() != *expected) {
            issues.push(format!("columns table={table} expected={expected_columns:?} actual={columns:?}"));
        }
    }
    for (name, expected_sql) in &expected_objects {
        let actual: Option<String> = connection.query_row("SELECT sql FROM sqlite_master WHERE name=?1", [name], |r| r.get(0)).optional()?;
        let normalized_actual = actual.as_deref().map(normalize_sql);
        if normalized_actual.as_deref() != Some(expected_sql.as_str()) {
            let detail = normalized_actual.as_deref().map(|actual| {
                let first_diff = expected_sql.bytes().zip(actual.bytes()).position(|(a,b)| a != b).unwrap_or(expected_sql.len().min(actual.len()));
                format!("expected_len={} actual_len={} first_diff_byte={first_diff}", expected_sql.len(), actual.len())
            }).unwrap_or_else(|| format!("expected_len={} actual=<missing>", expected_sql.len()));
            issues.push(format!("object_sql name={name} {detail}"));
        }
    }

    for (child, parent, from_columns, to_columns) in FOREIGN_KEYS {
        let mut stmt = connection.prepare(&format!("PRAGMA foreign_key_list({child})"))?;
        let rows = stmt.query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?, r.get::<_, String>(2)?, r.get::<_, String>(3)?, r.get::<_, String>(4)?, r.get::<_, String>(6)?)))?;
        let mut groups: HashMap<i64, (String, String, Vec<(i64, String, String)>)> = HashMap::new();
        for row in rows {
            let (id, seq, table, from, to, on_delete) = row?;
            let entry = groups.entry(id).or_insert_with(|| (table.clone(), on_delete.clone(), Vec::new()));
            if entry.0 != table || entry.1 != on_delete { return Err(StoreError::IncompatibleSchema); }
            entry.2.push((seq, from, to));
        }
        let found = groups.values_mut().any(|(table, on_delete, columns)| {
            columns.sort_by_key(|v| v.0);
            table.as_str() == *parent && on_delete == "RESTRICT"
                && columns.iter().map(|v| v.1.as_str()).eq(from_columns.iter().copied())
                && columns.iter().map(|v| v.2.as_str()).eq(to_columns.iter().copied())
        });
        if !found { issues.push(format!("foreign_key child={child} parent={parent} columns={from_columns:?}->{to_columns:?} on_delete=RESTRICT missing")); }
    }

    let version: Option<i64> = connection.query_row("SELECT schema_version FROM finance_v2_meta", [], |r| r.get(0)).optional()?;
    if version != Some(SCHEMA_VERSION) { issues.push(format!("schema_version expected={SCHEMA_VERSION} actual={version:?}")); }

    let trigger_count: i64 = connection.query_row("SELECT COUNT(*) FROM sqlite_master WHERE type='trigger' AND substr(name,1,11)='finance_v2_'", [], |r| r.get(0))?;
    if trigger_count != TRIGGER_TARGETS.len() as i64 { issues.push(format!("trigger_count expected={} actual={trigger_count}", TRIGGER_TARGETS.len())); }
    for (trigger, expected_table) in TRIGGER_TARGETS {
        let actual: Option<(String, String)> = connection.query_row("SELECT tbl_name,sql FROM sqlite_master WHERE type='trigger' AND name=?1", [trigger], |r| Ok((r.get(0)?, r.get(1)?))).optional()?;
        match actual {
            None => issues.push(format!("trigger missing name={trigger}")),
            Some((table, sql)) => {
                let upper = sql.to_ascii_uppercase();
                let expected_action = if trigger.contains("_no_update") || trigger.ends_with("_update") || trigger.contains("_update_") || *trigger == "finance_v2_account_kind_locked" { "BEFORE UPDATE" } else if trigger.contains("_no_delete") { "BEFORE DELETE" } else { "BEFORE INSERT" };
                if table != *expected_table || !upper.contains(expected_action) || !upper.contains("RAISE(ABORT") {
                    issues.push(format!("trigger_definition name={trigger} expected_table={expected_table} actual_table={table} expected_action={expected_action}"));
                }
            }
        }
    }

    let settings_rows: i64 = connection.query_row("SELECT (SELECT COUNT(*) FROM finance_v2_rules_current WHERE singleton=1)+(SELECT COUNT(*) FROM finance_v2_ai_model_current WHERE singleton=1)", [], |r| r.get(0))?;
    if settings_rows != 2 { issues.push(format!("settings_singletons expected=2 actual={settings_rows}")); }

    let index_count: i64 = connection.query_row("SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND substr(name,1,11)='finance_v2_'", [], |r| r.get(0))?;
    if index_count != INDEXES.len() as i64 { issues.push(format!("index_count expected={} actual={index_count}", INDEXES.len())); }
    for (index, expected_table) in INDEXES {
        let actual: Option<(String, String)> = connection.query_row("SELECT tbl_name,sql FROM sqlite_master WHERE type='index' AND name=?1", [index], |r| Ok((r.get(0)?, r.get(1)?))).optional()?;
        match actual {
            None => issues.push(format!("index missing name={index}")),
            Some((table, sql)) if table != *expected_table || !sql.to_ascii_uppercase().contains("CREATE UNIQUE INDEX") => {
                issues.push(format!("index_definition name={index} expected_table={expected_table} actual_table={table}"));
            }
            Some(_) => {}
        }
    }
    Ok(issues)
}

fn expected_schema_objects()->Result<Vec<(String,String)>,StoreError>{
    let mut result=Vec::new();
    let mut current=String::new();
    let mut in_trigger=false;
    for line in DDL.lines(){
        let trimmed=line.trim();
        if current.is_empty() && !trimmed.to_ascii_uppercase().starts_with("CREATE "){continue;}
        if current.is_empty() && trimmed.to_ascii_uppercase().starts_with("CREATE TRIGGER "){in_trigger=true;}
        current.push_str(line);current.push('\n');
        let complete=if in_trigger{trimmed.ends_with("END;")}else{trimmed.ends_with(';')};
        if complete{
            let words=current.split_whitespace().collect::<Vec<_>>();
            let kind=words.get(1).ok_or(StoreError::IncompatibleSchema)?.to_ascii_uppercase();
            let name_index=if kind=="UNIQUE"{3}else{2};
            let name=words.get(name_index).ok_or(StoreError::IncompatibleSchema)?.trim_end_matches('(').to_owned();
            result.push((name,normalize_sql(&current)));
            current.clear();in_trigger=false;
        }
    }
    if !current.trim().is_empty(){return Err(StoreError::IncompatibleSchema)}
    Ok(result)
}

fn normalize_sql(value: &str) -> String {
    let mut normalized = String::with_capacity(value.len());
    let mut quote_end: Option<char> = None;
    let mut chars = value.chars().peekable();
    let mut pending_space = false;
    while let Some(ch) = chars.next() {
        if let Some(end) = quote_end {
            normalized.push(ch);
            if ch == end {
                if chars.peek().copied() == Some(end) {
                    normalized.push(chars.next().expect("peeked quote escape"));
                } else {
                    quote_end = None;
                }
            }
            continue;
        }
        if ch.is_whitespace() {
            pending_space = true;
            continue;
        }
        if pending_space && !normalized.is_empty() {
            normalized.push(' ');
        }
        pending_space = false;
        match ch {
            '\'' | '"' | '`' => {
                quote_end = Some(ch);
                normalized.push(ch);
            }
            '[' => {
                quote_end = Some(']');
                normalized.push(ch);
            }
            _ => normalized.push(ch.to_ascii_uppercase()),
        }
    }
    while normalized.chars().last().is_some_and(char::is_whitespace) {
        normalized.pop();
    }
    // sqlite_master omits the statement terminator while the canonical DDL
    // includes it. Strip only that final SQL separator, never a quoted value.
    if normalized.ends_with(';') {
        normalized.pop();
    }
    normalized
}

#[cfg(feature = "finance-v2-test-support")]
pub fn sql_equivalent(left: &str, right: &str) -> bool {
    normalize_sql(left) == normalize_sql(right)
}

fn count_objects(connection: &Connection, object_type: &str) -> Result<i64, StoreError> {
    let sql = match object_type {
        "table" => "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND substr(name,1,11)='finance_v2_'",
        _ => return Err(StoreError::IncompatibleSchema),
    };
    Ok(connection.query_row(sql, params![], |row| row.get(0))?)
}
