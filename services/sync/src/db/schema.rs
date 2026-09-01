pub const MIGRATION_V1: &str = r#"
CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at_utc TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY,
    created_at_utc TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active'
);

CREATE TABLE IF NOT EXISTS devices (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id),
    label TEXT,
    created_at_utc TEXT NOT NULL,
    revoked_at_utc TEXT,
    status TEXT NOT NULL DEFAULT 'active'
);

CREATE TABLE IF NOT EXISTS device_tokens (
    id TEXT PRIMARY KEY,
    device_id TEXT NOT NULL REFERENCES devices(id),
    token_hash TEXT NOT NULL UNIQUE,
    created_at_utc TEXT NOT NULL,
    expires_at_utc TEXT,
    revoked_at_utc TEXT
);

CREATE TABLE IF NOT EXISTS device_capabilities (
    device_id TEXT NOT NULL REFERENCES devices(id),
    capability TEXT NOT NULL,
    granted_at_utc TEXT NOT NULL,
    PRIMARY KEY (device_id, capability)
);

CREATE TABLE IF NOT EXISTS enrollment_invites (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id),
    invite_hash TEXT NOT NULL UNIQUE,
    created_at_utc TEXT NOT NULL,
    expires_at_utc TEXT NOT NULL,
    consumed_at_utc TEXT,
    consumed_device_id TEXT
);

CREATE TABLE IF NOT EXISTS account_change_seq (
    account_id TEXT PRIMARY KEY REFERENCES accounts(id),
    next_seq INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS natural_keys (
    account_id TEXT NOT NULL,
    record_type TEXT NOT NULL,
    natural_key_hash TEXT NOT NULL,
    record_id TEXT NOT NULL,
    PRIMARY KEY (account_id, record_type, natural_key_hash)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_natural_keys_record
    ON natural_keys(account_id, record_type, record_id);

CREATE TABLE IF NOT EXISTS current_records (
    account_id TEXT NOT NULL,
    domain TEXT NOT NULL,
    record_type TEXT NOT NULL,
    record_id TEXT NOT NULL,
    server_version INTEGER NOT NULL,
    content_hash TEXT NOT NULL,
    snapshot_json TEXT NOT NULL,
    tombstone_json TEXT,
    natural_key_json TEXT NOT NULL,
    is_tombstone INTEGER NOT NULL DEFAULT 0,
    change_seq INTEGER NOT NULL,
    updated_at_utc TEXT NOT NULL,
    PRIMARY KEY (account_id, domain, record_type, record_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_current_records_version
    ON current_records(account_id, domain, record_type, record_id, server_version);

CREATE TABLE IF NOT EXISTS record_versions (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    domain TEXT NOT NULL,
    record_type TEXT NOT NULL,
    record_id TEXT NOT NULL,
    server_version INTEGER NOT NULL,
    kind TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    snapshot_json TEXT,
    tombstone_json TEXT,
    natural_key_json TEXT NOT NULL,
    is_tombstone INTEGER NOT NULL DEFAULT 0,
    change_seq INTEGER NOT NULL,
    op_id TEXT NOT NULL,
    device_id TEXT,
    created_at_utc TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_record_versions_entity_version
    ON record_versions(account_id, domain, record_type, record_id, server_version);

CREATE TABLE IF NOT EXISTS operations (
    account_id TEXT NOT NULL,
    op_id TEXT NOT NULL,
    device_id TEXT NOT NULL,
    request_fingerprint TEXT NOT NULL,
    status TEXT NOT NULL,
    result_json TEXT,
    created_at_utc TEXT NOT NULL,
    processed_at_utc TEXT,
    PRIMARY KEY (account_id, op_id)
);

CREATE TABLE IF NOT EXISTS conflicts (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    domain TEXT NOT NULL,
    record_type TEXT NOT NULL,
    record_id TEXT NOT NULL,
    server_version INTEGER NOT NULL,
    client_base_version INTEGER,
    client_content_hash TEXT NOT NULL,
    client_snapshot_json TEXT NOT NULL,
    server_content_hash TEXT NOT NULL,
    server_snapshot_json TEXT NOT NULL,
    device_id TEXT NOT NULL,
    op_id TEXT NOT NULL,
    created_at_utc TEXT NOT NULL,
    resolved_at_utc TEXT,
    status TEXT NOT NULL DEFAULT 'open'
);

CREATE TABLE IF NOT EXISTS delivery_acks (
    account_id TEXT NOT NULL,
    device_id TEXT NOT NULL,
    delivered_change_seq INTEGER NOT NULL DEFAULT 0,
    updated_at_utc TEXT NOT NULL,
    PRIMARY KEY (account_id, device_id)
);

CREATE TABLE IF NOT EXISTS connector_writer_states (
    account_id TEXT NOT NULL,
    connector TEXT NOT NULL,
    phase TEXT NOT NULL,
    principal TEXT,
    lease_holder TEXT,
    lease_expires_at_utc TEXT,
    audit_watermark TEXT,
    state_json TEXT NOT NULL,
    updated_at_utc TEXT NOT NULL,
    PRIMARY KEY (account_id, connector)
);
"#;

pub const MIGRATION_V2: &str = r#"
ALTER TABLE connector_writer_states ADD COLUMN phase_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE connector_writer_states ADD COLUMN fencing_token TEXT;
ALTER TABLE connector_writer_states ADD COLUMN drain_watermark TEXT;

CREATE TABLE IF NOT EXISTS work_commands (
    command_id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    origin_device_id TEXT NOT NULL,
    kind_json TEXT NOT NULL,
    payload_hash TEXT NOT NULL,
    expected_content_hash TEXT,
    expected_external_etag TEXT,
    status TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 3,
    retry_once_consumed INTEGER NOT NULL DEFAULT 0,
    created_at_utc TEXT NOT NULL,
    updated_at_utc TEXT NOT NULL,
    result_summary TEXT,
    external_task_id TEXT
);

CREATE TABLE IF NOT EXISTS work_command_attempts (
    id TEXT PRIMARY KEY,
    command_id TEXT NOT NULL REFERENCES work_commands(command_id),
    attempt_no INTEGER NOT NULL,
    started_at_utc TEXT NOT NULL,
    finished_at_utc TEXT,
    outcome TEXT,
    error_summary TEXT
);

CREATE TABLE IF NOT EXISTS work_command_claims (
    command_id TEXT PRIMARY KEY REFERENCES work_commands(command_id),
    lease_holder TEXT NOT NULL,
    fencing_token TEXT NOT NULL,
    claimed_at_utc TEXT NOT NULL,
    expires_at_utc TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS manual_confirmations (
    id TEXT PRIMARY KEY,
    command_id TEXT NOT NULL REFERENCES work_commands(command_id),
    account_id TEXT NOT NULL,
    reason TEXT NOT NULL,
    created_at_utc TEXT NOT NULL,
    resolved_at_utc TEXT,
    resolution TEXT
);

CREATE TABLE IF NOT EXISTS ticktick_projections (
    account_id TEXT NOT NULL,
    projection_key TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    updated_at_utc TEXT NOT NULL,
    PRIMARY KEY (account_id, projection_key)
);

CREATE TABLE IF NOT EXISTS oauth_transactions (
    transaction_id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    device_id TEXT NOT NULL,
    state_hash TEXT NOT NULL,
    pkce_verifier_enc TEXT NOT NULL,
    redirect_uri TEXT NOT NULL,
    created_at_utc TEXT NOT NULL,
    expires_at_utc TEXT NOT NULL,
    consumed_at_utc TEXT,
    status TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ticktick_credentials (
    account_id TEXT PRIMARY KEY,
    device_id TEXT NOT NULL,
    ciphertext TEXT NOT NULL,
    metadata_json TEXT NOT NULL,
    updated_at_utc TEXT NOT NULL,
    revoked_at_utc TEXT
);
"#;

pub const MIGRATION_V3: &str = r#"
ALTER TABLE operations ADD COLUMN correlation_id TEXT;

CREATE TABLE IF NOT EXISTS operation_events (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    op_id TEXT NOT NULL,
    correlation_id TEXT,
    connector TEXT,
    event_kind TEXT NOT NULL,
    detail_json TEXT NOT NULL,
    created_at_utc TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_operation_events_account_op
    ON operation_events(account_id, op_id, created_at_utc);
"#;

pub const MIGRATION_V4: &str = r#"
-- An ACK is only proof of a response the server actually issued to this device.
-- Keep this separate from global head: another device's write must never let a
-- client advance its watermark past data it has not been sent.
CREATE TABLE IF NOT EXISTS delivery_issued (
    account_id TEXT NOT NULL,
    device_id TEXT NOT NULL,
    issued_change_seq INTEGER NOT NULL DEFAULT 0,
    updated_at_utc TEXT NOT NULL,
    PRIMARY KEY (account_id, device_id)
);
"#;
