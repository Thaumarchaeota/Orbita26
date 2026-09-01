mod confirmation;
mod credential;
mod mock;
mod oauth;
mod outbox;
mod projection;
mod reconciliation;
mod state;
mod store;

pub use confirmation::*;
pub use credential::*;
pub use mock::*;
pub use oauth::*;
pub use outbox::*;
pub use projection::*;
pub use reconciliation::*;
pub use state::*;
pub use store::*;

#[cfg(test)]
mod behavior_tests {
    use super::*;
    use chrono::NaiveDate;

    fn sample_task(id: &str) -> TaskProjection {
        TaskProjection {
            task_id: id.into(),
            project_id: "proj-1".into(),
            title: "Test task".into(),
            content: None,
            completed: false,
            due_date: None,
            start_date: None,
            priority: 0,
            content_hash: "hash-v1".into(),
            synced_at: chrono::Utc::now(),
            external_etag: Some("etag-1".into()),
        }
    }

    #[test]
    fn complete_then_undo_within_window() {
        let mut provider = MockTickTickProvider::new("acct").with_task(sample_task("t1"));
        let mut complete = WorkCommand::new(
            "acct",
            "dev-1",
            CommandKind::CompleteTask {
                task_id: "t1".into(),
            },
            "h1",
        );
        provider.execute_command(&mut complete).unwrap();
        assert_eq!(complete.status, CommandStatus::Succeeded);
        assert!(provider.mirror().tasks[0].completed);

        let mut undo = WorkCommand::new(
            "acct",
            "dev-1",
            CommandKind::UndoComplete {
                task_id: "t1".into(),
            },
            "h2",
        );
        provider.execute_command(&mut undo).unwrap();
        assert_eq!(undo.status, CommandStatus::Succeeded);
        assert!(!provider.mirror().tasks[0].completed);
    }

    #[test]
    fn due_and_start_shift() {
        let mut provider = MockTickTickProvider::new("acct").with_task(sample_task("t1"));
        let due = NaiveDate::from_ymd_opt(2026, 2, 1).unwrap();
        let start = NaiveDate::from_ymd_opt(2026, 1, 28).unwrap();

        let mut shift_due = WorkCommand::new(
            "acct",
            "dev-1",
            CommandKind::ShiftDue {
                task_id: "t1".into(),
                new_due: Some(due),
            },
            "h1",
        );
        provider.execute_command(&mut shift_due).unwrap();
        assert_eq!(provider.mirror().tasks[0].due_date, Some(due));

        let mut shift_start = WorkCommand::new(
            "acct",
            "dev-1",
            CommandKind::ShiftStart {
                task_id: "t1".into(),
                new_start: Some(start),
            },
            "h2",
        );
        provider.execute_command(&mut shift_start).unwrap();
        assert_eq!(provider.mirror().tasks[0].start_date, Some(start));
    }

    #[test]
    fn external_edit_conflict() {
        let mut provider = MockTickTickProvider::new("acct").with_task(sample_task("t1"));
        provider.simulate_external_edit("t1", "hash-remote");

        let mut update = WorkCommand::new(
            "acct",
            "dev-1",
            CommandKind::UpdateTask {
                task_id: "t1".into(),
            },
            "h1",
        );
        provider.execute_command(&mut update).unwrap();
        assert_eq!(update.status, CommandStatus::Conflict);
    }

    #[test]
    fn offline_conflict_blocks_duplicate_pending() {
        let mut detector = OfflineConflictDetector::new();
        let cmd1 = WorkCommand::new(
            "acct",
            "dev-1",
            CommandKind::UpdateTask {
                task_id: "t1".into(),
            },
            "h1",
        );
        let cmd2 = WorkCommand::new(
            "acct",
            "dev-1",
            CommandKind::CompleteTask {
                task_id: "t1".into(),
            },
            "h2",
        );
        detector.enqueue(cmd1).unwrap();
        let err = detector.enqueue(cmd2).unwrap_err();
        assert!(err.contains("offline conflict"));
    }

    #[test]
    fn create_timeout_no_blind_retry() {
        let mut provider = MockTickTickProvider::new("acct");
        let mut create = WorkCommand::new(
            "acct",
            "dev-1",
            CommandKind::CreateTask {
                title: "New".into(),
                project_id: "proj-1".into(),
            },
            "h1",
        );
        provider.execute_command(&mut create).unwrap();
        assert_eq!(create.status, CommandStatus::Succeeded);

        let mut timeout_create = WorkCommand::new(
            "acct",
            "dev-1",
            CommandKind::CreateTask {
                title: "Ambiguous".into(),
                project_id: "proj-1".into(),
            },
            "h2",
        );
        provider.execute_command(&mut timeout_create).unwrap();
        assert_eq!(
            timeout_create.status,
            CommandStatus::AwaitingManualConfirmation
        );
        assert!(!timeout_create.can_retry());
    }

    #[test]
    fn broker_state_machine_happy_path() {
        let mut phase = BrokerPhase::DesktopDirect;
        phase = transition(phase, BrokerEvent::BeginOauthMirror, 0).unwrap();
        assert_eq!(phase, BrokerPhase::ServerOauthMirror);
        phase = transition(phase, BrokerEvent::OauthMirrorComplete, 0).unwrap();
        assert_eq!(phase, BrokerPhase::DesktopWriteFreeze);
        phase = transition(phase, BrokerEvent::ActivateServerBroker, 0).unwrap();
        assert_eq!(phase, BrokerPhase::ServerBrokerActive);
    }

    #[test]
    fn broker_rollback_blocked_while_active() {
        let err = transition(BrokerPhase::ServerBrokerActive, BrokerEvent::RollbackToDesktop, 0)
            .unwrap_err();
        assert!(matches!(err, BrokerTransitionError::ServerBrokerActive));
    }
}
