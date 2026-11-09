import { invoke } from "@tauri-apps/api/core";
import { invokeDomainWrite } from "../admin/domain-write-guard";
import type {
  AssignCheckpointSessionRequest,
  CommitCheckpointArrangementRequest,
  CommitItemWithCheckpointRequest,
  ItemWithCheckpointResponse,
  CheckpointRequest,
  CheckpointResponse,
  CheckpointsListResponse,
  CompleteCheckpointRequest,
  CorrectCheckpointActualRequest,
  CreateCheckpointRequest,
  GetCheckpointRequest,
  ListCheckpointsRequest,
  SetCheckpointTargetRequest,
  UpdateCheckpointRequest,
} from "./checkpoint-types";

// The browser guard and Archive expectedDataDir check keep writes on one root; see docs/plans/checkpoint-travel-data-foundation.md.
export function productivityCreateCheckpoint(req: CreateCheckpointRequest) {
  return invokeDomainWrite<CheckpointResponse>("productivity_create_checkpoint", { req });
}

export function productivityGetCheckpoint(req: GetCheckpointRequest) {
  return invoke<CheckpointResponse>("productivity_get_checkpoint", { req });
}

export function productivityListCheckpoints(req: ListCheckpointsRequest) {
  return invoke<CheckpointsListResponse>("productivity_list_checkpoints", { req });
}

export function productivityUpdateCheckpoint(req: UpdateCheckpointRequest) {
  return invokeDomainWrite<CheckpointResponse>("productivity_update_checkpoint", { req });
}

export function productivityCompleteCheckpoint(req: CompleteCheckpointRequest) {
  return invokeDomainWrite<CheckpointResponse>("productivity_complete_checkpoint", { req });
}

export function productivityCorrectCheckpointActual(req: CorrectCheckpointActualRequest) {
  return invokeDomainWrite<CheckpointResponse>("productivity_correct_checkpoint_actual", { req });
}

export function productivityReopenCheckpoint(req: CheckpointRequest) {
  return invokeDomainWrite<CheckpointResponse>("productivity_reopen_checkpoint", { req });
}

export function productivityDeleteCheckpoint(req: CheckpointRequest) {
  return invokeDomainWrite<CheckpointResponse>("productivity_delete_checkpoint", { req });
}

export function productivityRestoreCheckpoint(req: CheckpointRequest) {
  return invokeDomainWrite<CheckpointResponse>("productivity_restore_checkpoint", { req });
}

export function productivitySetCheckpointTarget(req: SetCheckpointTargetRequest) {
  return invokeDomainWrite<CheckpointResponse>("productivity_set_checkpoint_target", { req });
}

export function productivityClearCheckpointTarget(req: CheckpointRequest) {
  return invokeDomainWrite<CheckpointResponse>("productivity_clear_checkpoint_target", { req });
}

export function productivityAssignCheckpointToSession(req: AssignCheckpointSessionRequest) {
  return invokeDomainWrite<CheckpointResponse>("productivity_assign_checkpoint_to_session", { req });
}

export function productivityRemoveCheckpointFromSession(req: CheckpointRequest) {
  return invokeDomainWrite<CheckpointResponse>("productivity_remove_checkpoint_from_session", { req });
}

export function productivityCommitItemWithCheckpoint(req: CommitItemWithCheckpointRequest) {
  return invokeDomainWrite<ItemWithCheckpointResponse>("productivity_commit_item_with_checkpoint", { req });
}
export function productivityCommitCheckpointArrangement(req: CommitCheckpointArrangementRequest) {
  return invokeDomainWrite<CheckpointResponse>("productivity_commit_checkpoint_arrangement", { req });
}
