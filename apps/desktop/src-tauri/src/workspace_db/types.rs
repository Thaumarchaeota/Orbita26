use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContainerRef {
    pub id: String,
    pub expected_revision: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemberRef {
    pub id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DomainRootRef {
    pub id: String,
    pub expected_revision: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemberSnapshot {
    pub id: String,
    pub container_id: String,
    pub position: i32,
    pub member_kind: String,
    pub domain: Option<String>,
    pub object_type: Option<String>,
    pub object_id: Option<String>,
    pub link_kind: Option<String>,
    pub link_title: Option<String>,
    pub link_url: Option<String>,
    pub local_path: Option<String>,
    pub revision: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GroupSnapshot {
    pub id: String,
    pub title: String,
    pub revision: i64,
    pub root_position: i32,
    pub members: Vec<MemberSnapshot>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RootContainerSnapshot {
    pub id: String,
    pub revision: i64,
    pub members: Vec<MemberSnapshot>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceResponse {
    pub root: RootContainerSnapshot,
    pub groups: Vec<GroupSnapshot>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListWorkspaceQuery {
    pub device_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateGroupRequest {
    pub title: String,
    pub root: ContainerRef,
    pub root_position: Option<i32>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameGroupRequest {
    pub group: ContainerRef,
    pub title: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MoveWorkspaceMemberRequest {
    pub member_id: String,
    pub source: ContainerRef,
    pub target: ContainerRef,
    pub position: Option<i32>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReorderWorkspaceContainerRequest {
    pub container: ContainerRef,
    pub member_ids: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddListToWorkspaceRequest {
    pub list: DomainRootRef,
    pub container: ContainerRef,
    pub position: Option<i32>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddJournalDocumentToWorkspaceRequest {
    pub entry: DomainRootRef,
    pub container: ContainerRef,
    pub position: Option<i32>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoveListFromWorkspaceRequest {
    pub container: ContainerRef,
    pub member: MemberRef,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateWorkspaceLinkRequest {
    pub container: ContainerRef,
    pub link_kind: String,
    pub link_title: String,
    pub link_url: Option<String>,
    pub local_path: Option<String>,
    pub device_id: Option<String>,
    pub position: Option<i32>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameWorkspaceLinkRequest {
    pub container: ContainerRef,
    pub member: MemberRef,
    pub member_expected_revision: i64,
    pub link_title: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateWorkspaceLinkTargetRequest {
    pub container: ContainerRef,
    pub member: MemberRef,
    pub member_expected_revision: i64,
    pub link_url: Option<String>,
    pub local_path: Option<String>,
    pub device_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RebindLocalTargetRequest {
    pub container: ContainerRef,
    pub member: MemberRef,
    pub member_expected_revision: i64,
    pub device_id: String,
    pub local_path: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteWorkspaceLinkRequest {
    pub container: ContainerRef,
    pub member: MemberRef,
    pub member_expected_revision: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteGroupAndReleaseMembersRequest {
    pub group: ContainerRef,
    pub root: ContainerRef,
    pub expected_members: Vec<MemberRef>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteProjectFromWorkspaceRequest {
    pub project: DomainRootRef,
    pub container: ContainerRef,
    pub member: MemberRef,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteListBodyRequest {
    pub list: DomainRootRef,
    pub container: ContainerRef,
    pub member: MemberRef,
    pub expected_members: Vec<DomainRootRef>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteJournalDocumentFromWorkspaceRequest {
    pub entry: DomainRootRef,
    pub container: ContainerRef,
    pub member: MemberRef,
}
