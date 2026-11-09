import { invoke } from "@tauri-apps/api/core";
import { invokeDomainWrite } from "../admin/domain-write-guard";

export type ContainerRef = {
  id: string;
  expectedRevision: number;
};

export type MemberRef = {
  id: string;
};

export type DomainRootRef = {
  id: string;
  expectedRevision: number;
};

export type MemberSnapshot = {
  id: string;
  containerId: string;
  position: number;
  memberKind: string;
  domain: string | null;
  objectType: string | null;
  objectId: string | null;
  linkKind: string | null;
  linkTitle: string | null;
  linkUrl: string | null;
  localPath: string | null;
  revision: number;
};

export type GroupSnapshot = {
  id: string;
  title: string;
  revision: number;
  rootPosition: number;
  members: MemberSnapshot[];
};

export type RootContainerSnapshot = {
  id: string;
  revision: number;
  members: MemberSnapshot[];
};

export type WorkspaceResponse = {
  root: RootContainerSnapshot;
  groups: GroupSnapshot[];
};

export type ListWorkspaceQuery = {
  deviceId?: string;
};

export type CreateGroupRequest = {
  title: string;
  root: ContainerRef;
  rootPosition?: number;
};

export type RenameGroupRequest = {
  group: ContainerRef;
  title: string;
};

export type MoveWorkspaceMemberRequest = {
  memberId: string;
  source: ContainerRef;
  target: ContainerRef;
  position?: number;
};

export type ReorderWorkspaceContainerRequest = {
  container: ContainerRef;
  memberIds: string[];
};

export type AddListToWorkspaceRequest = {
  list: DomainRootRef;
  container: ContainerRef;
  position?: number;
};

export type AddJournalDocumentToWorkspaceRequest = {
  entry: DomainRootRef;
  container: ContainerRef;
  position?: number;
};

export type RemoveListFromWorkspaceRequest = {
  container: ContainerRef;
  member: MemberRef;
};

export type CreateWorkspaceLinkRequest = {
  container: ContainerRef;
  linkKind: string;
  linkTitle: string;
  linkUrl?: string;
  localPath?: string;
  deviceId?: string;
  position?: number;
};

export type RenameWorkspaceLinkRequest = {
  container: ContainerRef;
  member: MemberRef;
  memberExpectedRevision: number;
  linkTitle: string;
};

export type UpdateWorkspaceLinkTargetRequest = {
  container: ContainerRef;
  member: MemberRef;
  memberExpectedRevision: number;
  linkUrl?: string;
  localPath?: string;
  deviceId?: string;
};

export type RebindLocalTargetRequest = {
  container: ContainerRef;
  member: MemberRef;
  memberExpectedRevision: number;
  deviceId: string;
  localPath: string;
};

export type DeleteWorkspaceLinkRequest = {
  container: ContainerRef;
  member: MemberRef;
  memberExpectedRevision: number;
};

export type DeleteGroupAndReleaseMembersRequest = {
  group: ContainerRef;
  root: ContainerRef;
  expectedMembers: MemberRef[];
};

export type DeleteProjectFromWorkspaceRequest = {
  project: DomainRootRef;
  container: ContainerRef;
  member: MemberRef;
};

export type DeleteListBodyRequest = {
  list: DomainRootRef;
  container: ContainerRef;
  member: MemberRef;
  expectedMembers: DomainRootRef[];
};

export type DeleteJournalDocumentFromWorkspaceRequest = {
  entry: DomainRootRef;
  container: ContainerRef;
  member: MemberRef;
};

export function workspaceList(req: ListWorkspaceQuery = {}) {
  return invoke<WorkspaceResponse>("workspace_list", { req });
}

export function workspaceCreateGroup(req: CreateGroupRequest) {
  return invokeDomainWrite<WorkspaceResponse>("workspace_create_group", { req });
}

export function workspaceRenameGroup(req: RenameGroupRequest) {
  return invokeDomainWrite<WorkspaceResponse>("workspace_rename_group", { req });
}

export function workspaceMoveMember(req: MoveWorkspaceMemberRequest) {
  return invokeDomainWrite<WorkspaceResponse>("workspace_move_member", { req });
}

export function workspaceReorderContainer(req: ReorderWorkspaceContainerRequest) {
  return invokeDomainWrite<WorkspaceResponse>("workspace_reorder_container", { req });
}

export function workspaceAddList(req: AddListToWorkspaceRequest) {
  return invokeDomainWrite<WorkspaceResponse>("workspace_add_list", { req });
}

export function workspaceAddJournalDocument(req: AddJournalDocumentToWorkspaceRequest) {
  return invokeDomainWrite<WorkspaceResponse>("workspace_add_journal_document", { req });
}

export function workspaceRemoveList(req: RemoveListFromWorkspaceRequest) {
  return invokeDomainWrite<WorkspaceResponse>("workspace_remove_list", { req });
}

export function workspaceCreateLink(req: CreateWorkspaceLinkRequest) {
  return invokeDomainWrite<WorkspaceResponse>("workspace_create_link", { req });
}

export function workspaceRenameLink(req: RenameWorkspaceLinkRequest) {
  return invokeDomainWrite<WorkspaceResponse>("workspace_rename_link", { req });
}

export function workspaceUpdateLinkTarget(req: UpdateWorkspaceLinkTargetRequest) {
  return invokeDomainWrite<WorkspaceResponse>("workspace_update_link_target", { req });
}

export function workspaceRebindLocalTarget(req: RebindLocalTargetRequest) {
  return invokeDomainWrite<WorkspaceResponse>("workspace_rebind_local_target", { req });
}

export function workspaceDeleteLink(req: DeleteWorkspaceLinkRequest) {
  return invokeDomainWrite<WorkspaceResponse>("workspace_delete_link", { req });
}

export function workspaceDeleteGroup(req: DeleteGroupAndReleaseMembersRequest) {
  return invokeDomainWrite<WorkspaceResponse>("workspace_delete_group", { req });
}

export function workspaceDeleteProject(req: DeleteProjectFromWorkspaceRequest) {
  return invokeDomainWrite<WorkspaceResponse>("workspace_delete_project", { req });
}

export function workspaceDeleteListBody(req: DeleteListBodyRequest) {
  return invokeDomainWrite<WorkspaceResponse>("workspace_delete_list_body", { req });
}

export function workspaceDeleteJournalDocument(req: DeleteJournalDocumentFromWorkspaceRequest) {
  return invokeDomainWrite<WorkspaceResponse>("workspace_delete_journal_document", { req });
}
