//! Explicit-session Finance v2 IPC. No command discovers a workspace or data root.
pub mod session;
pub mod wire;
pub mod ledger;
pub mod workspace;
pub mod commit;
pub mod commit_apply;
pub mod source;
pub mod history;
pub mod settings;
pub mod materialize;

pub use session::{
    finance_v2_environment_create, finance_v2_environment_open,
    finance_v2_environment_pick_directory, finance_v2_source_pick_file,
    FinanceV2Session,
};
pub use ledger::{finance_v2_management_save, finance_v2_project_reports, finance_v2_read_snapshot, finance_v2_source_bindings, finance_v2_source_contexts};
pub use workspace::{finance_v2_workspace_apply_ai_suggestions, finance_v2_workspace_cancel_import, finance_v2_workspace_create, finance_v2_workspace_create_manual, finance_v2_workspace_list, finance_v2_workspace_read, finance_v2_workspace_stage_intent, finance_v2_workspace_stage_refinement, finance_v2_workspace_undo, finance_v2_workspace_update_row};
pub use commit::{finance_v2_commit_batch,finance_v2_find_receipt,finance_v2_prepare_commit,finance_v2_recover_materialization,finance_v2_workspace_abandon};
pub use source::finance_v2_parse_artifact;
pub use history::finance_v2_history;
pub use settings::{finance_v2_ai_model_read,finance_v2_ai_model_save,finance_v2_rules_confirm_append,finance_v2_rules_open_file,finance_v2_rules_preview_append,finance_v2_rules_read,finance_v2_rules_save};
