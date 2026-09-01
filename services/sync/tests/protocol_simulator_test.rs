#[path = "protocol_simulator.rs"]
mod protocol_simulator;

use protocol_simulator::scenarios;

#[test]
fn bootstrap_two_devices() {
    let (server, _a, b) = scenarios::bootstrap_two_devices();
    assert!(!b.shadow.is_empty());
    assert!(server.applied_op_count() >= 1);
}

#[test]
fn duplicate_op() {
    assert!(scenarios::duplicate_op_idempotent());
}

#[test]
fn out_of_order() {
    assert!(scenarios::out_of_order_ops());
}

#[test]
fn lost_response() {
    assert!(scenarios::lost_response_safe_replay());
}

#[test]
fn crash_on_apply() {
    assert!(scenarios::crash_on_apply_no_partial_commit());
}

#[test]
fn cursor_interrupt() {
    assert!(scenarios::cursor_interrupt_resume());
}

#[test]
fn edit_edit() {
    assert!(scenarios::edit_edit_conflict());
}

#[test]
fn edit_delete() {
    assert!(scenarios::edit_delete_conflict());
}

#[test]
fn delete_edit() {
    assert!(scenarios::delete_edit_conflict());
}

#[test]
fn restore() {
    assert!(scenarios::restore_after_delete());
}

#[test]
fn root_switch() {
    assert!(scenarios::root_switch());
}

#[test]
fn device_revoke() {
    assert!(scenarios::device_revoke());
}

#[test]
fn conflict_preserve() {
    assert!(scenarios::conflict_preserve_both_versions());
}

#[test]
fn redaction() {
    assert!(scenarios::redaction_no_payload_in_logs());
}
