use crate::health_db::sync_run::{create_run, finish_run_failed};
use crate::productivity_db::coordinator::{in_transaction, with_write};

use super::harness::*;

#[test]
fn sync_run_no_token_records_failure_without_health_facts_or_coverage() {
    let archive = TestArchive::new();
    let data_dir = archive.data_dir_str();
    let conn = archive.conn();
    let run_id = new_run_id();
    let date = "2026-03-21";

    with_write(&data_dir, |c| {
        in_transaction(c, |tx| Ok(create_run(tx, &run_id, "manual", date, date)?))
    })
    .expect("create run");

    let summary = "尚未登录佳明，请到设置填写邮箱密码并点击「重新登录佳明」";
    with_write(&data_dir, |c| finish_run_failed(c, &run_id, "no_token", summary).map_err(Into::into))
        .expect("finish failed");

    let (status, code, err_summary) = sync_run_row(&conn, &run_id);
    assert_eq!(status, "failed");
    assert_eq!(code.as_deref(), Some("no_token"));
    assert_eq!(err_summary.as_deref(), Some(summary));
    assert_eq!(sync_run_coverage_count(&conn, &run_id), 0);
    assert_eq!(health_fact_count(&conn), 0);

    let summary_lower = err_summary.unwrap_or_default().to_lowercase();
    assert_eq!(code.as_deref(), Some("no_token"));
    assert!(!summary_lower.contains("bearer"));
    assert!(!summary_lower.contains("traceback"));
    assert!(!summary_lower.contains("garmin_tokens"));
    assert!(!summary_lower.contains("\"entries\""));

    archive.cleanup();
}
