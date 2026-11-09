import { attachIdentityDragSource } from "./tab-host/drag-session";
import { showCommandMenuAt } from "../../ui/command-menu-popover";
import { getNamePromptDialog } from "../shell/dialog";
import {
  openLocalPath,
  openUrl,
  pickAppFile,
  pickLocalFile,
  pickLocalFolder,
} from "../shell/adapter";
import { journalArchiveGetEntry } from "../journal/archive-client";
import {
  productivityCreateProject,
  productivityListLists,
  productivityListProjects,
} from "../productivity/client";
import type { ListSnapshot, ProjectSnapshot } from "../productivity/types";
import type { MemberSnapshot, WorkspaceResponse } from "../workspace/client";
import {
  workspaceAddJournalDocument,
  workspaceCreateGroup,
  workspaceCreateLink,
  workspaceDeleteGroup,
  workspaceDeleteLink,
  workspaceDeleteJournalDocument,
  workspaceMoveMember,
  workspaceRebindLocalTarget,
  workspaceRemoveList,
  workspaceRenameGroup,
  workspaceRenameLink,
  workspaceReorderContainer,
} from "../workspace/client";
import { DOMAIN_ICONS } from "./icons";
import {
  applyWorkspaceResponse,
  getDeviceId,
  getWorkspaceResponse,
  indexWorkspaceMembers,
  itemKey,
  keyToMemberId,
  loadWorkspaceNav,
  memberToItemKey,
  parseItemKey,
  reloadWorkspaceFromServer,
  saveWorkspaceNav,
  type IndexedMember,
  type WorkspaceItemKey,
} from "./workspace-nav-persist";

export type WorkspaceNavCallbacks = {
  onSelectProject: (projectId: string) => void;
  onSelectList: (listId: string) => void;
  onDeleteProject?: (projectId: string) => void;
  getActiveKey: () => string | null;
};

export type WorkspaceNavHandle = {
  refresh: () => Promise<void>;
  updateActive: () => void;
  dispose: () => void;
};

const PROJECT_ICON = DOMAIN_ICONS.work;
const LIST_ICON = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>`;
const LINK_ICON = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>`;
const JOURNAL_ICON = DOMAIN_ICONS.journal;
const COLLAPSE_ICON = `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>`;

function liveProjects(projects: ProjectSnapshot[]): ProjectSnapshot[] {
  return projects.filter((p) => !p.deletedAtUtc);
}

function liveLists(lists: ListSnapshot[]): ListSnapshot[] {
  return lists.filter((l) => !l.deletedAtUtc);
}

function projectMap(projects: ProjectSnapshot[]): Map<string, ProjectSnapshot> {
  return new Map(projects.map((p) => [p.id, p]));
}

function listMap(lists: ListSnapshot[]): Map<string, ListSnapshot> {
  return new Map(lists.map((l) => [l.id, l]));
}

function titleForMember(
  member: MemberSnapshot,
  projects: Map<string, ProjectSnapshot>,
  lists: Map<string, ListSnapshot>,
): string {
  if (member.memberKind === "link") return member.linkTitle ?? "链接";
  if (member.memberKind === "journal_document" && member.objectId) {
    return member.objectId.slice(0, 8);
  }
  if (member.memberKind === "project" && member.objectId) {
    return projects.get(member.objectId)?.title ?? "项目";
  }
  if (member.memberKind === "list" && member.objectId) {
    return lists.get(member.objectId)?.title ?? "清单";
  }
  return "条目";
}

function iconForMember(member: MemberSnapshot): string {
  if (member.memberKind === "link") return LINK_ICON;
  if (member.memberKind === "journal_document") return JOURNAL_ICON;
  if (member.memberKind === "list") return LIST_ICON;
  return PROJECT_ICON;
}

function memberForKey(
  key: WorkspaceItemKey,
  workspace: WorkspaceResponse,
  memberIndex: Map<string, IndexedMember>,
): IndexedMember | null {
  const memberId = keyToMemberId(workspace, key);
  if (!memberId) return null;
  return memberIndex.get(memberId) ?? null;
}

function placedProjectIds(workspace: WorkspaceResponse): Set<string> {
  const ids = new Set<string>();
  for (const member of workspace.root.members) {
    if (member.memberKind === "project" && member.objectId) ids.add(member.objectId);
  }
  for (const group of workspace.groups) {
    for (const member of group.members) {
      if (member.memberKind === "project" && member.objectId) ids.add(member.objectId);
    }
  }
  return ids;
}

export function mountWorkspaceNav(
  container: HTMLElement,
  callbacks: WorkspaceNavCallbacks,
): WorkspaceNavHandle {
  let state = loadWorkspaceNav();
  let workspace: WorkspaceResponse | null = getWorkspaceResponse();
  let memberIndex = workspace ? indexWorkspaceMembers(workspace) : new Map();
  let projects: ProjectSnapshot[] = [];
  let lists: ListSnapshot[] = [];
  let disposed = false;
  const ac = new AbortController();

  container.className = "admin-workspace-section";
  container.id = "adminWorkspace";

  const onRefresh = () => {
    void refresh();
  };
  window.addEventListener("orbita-workspace-refresh", onRefresh);

  function syncFromCache(): void {
    workspace = getWorkspaceResponse();
    memberIndex = workspace ? indexWorkspaceMembers(workspace) : new Map();
    state = loadWorkspaceNav();
  }

  async function applyMutation(
    fn: () => Promise<WorkspaceResponse>,
  ): Promise<boolean> {
    try {
      const res = await fn();
      applyWorkspaceResponse(res);
      syncFromCache();
      render();
      return true;
    } catch (e) {
      alert(String(e));
      await reloadWorkspaceFromServer();
      syncFromCache();
      render();
      return false;
    }
  }

  function setGroupCollapsed(groupId: string, collapsed: boolean): void {
    state = {
      ...state,
      groups: state.groups.map((g) => (g.id === groupId ? { ...g, collapsed } : g)),
    };
    saveWorkspaceNav(state);
    render();
  }

  async function moveRootMember(memberId: string, direction: "up" | "down"): Promise<void> {
    if (!workspace) return;
    const members = [...workspace.root.members].sort((a, b) => a.position - b.position);
    const idx = members.findIndex((m) => m.id === memberId);
    if (idx < 0) return;
    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= members.length) return;
    const ids = members.map((m) => m.id);
    [ids[idx], ids[swapIdx]] = [ids[swapIdx], ids[idx]];
    await applyMutation(() =>
      workspaceReorderContainer({
        container: { id: workspace!.root.id, expectedRevision: workspace!.root.revision },
        memberIds: ids,
      }),
    );
  }

  async function moveMemberToGroup(key: WorkspaceItemKey, groupId: string | null): Promise<void> {
    if (!workspace) return;
    const indexed = memberForKey(key, workspace, memberIndex);
    if (!indexed) return;
    const targetId = groupId ?? workspace.root.id;
    const targetRev =
      targetId === workspace.root.id
        ? workspace.root.revision
        : workspace.groups.find((g) => g.id === targetId)?.revision;
    if (targetRev == null) return;
    if (indexed.containerId === targetId) return;
    await applyMutation(() =>
      workspaceMoveMember({
        memberId: indexed.member.id,
        source: { id: indexed.containerId, expectedRevision: indexed.containerRevision },
        target: { id: targetId, expectedRevision: targetRev },
      }),
    );
  }

  async function openLinkMember(member: MemberSnapshot): Promise<void> {
    if (member.linkKind === "bookmark") {
      if (member.linkUrl) await openUrl(member.linkUrl);
      return;
    }
    if (member.localPath) {
      try {
        await openLocalPath(member.localPath);
      } catch {
        /* rebind via context menu */
      }
      return;
    }
  }

  async function rebindLinkMember(indexed: IndexedMember): Promise<void> {
    const kind = indexed.member.linkKind;
    let path: string | null = null;
    if (kind === "executable") path = await pickAppFile();
    else if (kind === "folder") path = await pickLocalFolder();
    else if (kind === "file") path = await pickLocalFile();
    if (!path) return;
    await applyMutation(() =>
      workspaceRebindLocalTarget({
        container: { id: indexed.containerId, expectedRevision: indexed.containerRevision },
        member: { id: indexed.member.id },
        memberExpectedRevision: indexed.member.revision,
        deviceId: getDeviceId(),
        localPath: path,
      }),
    );
  }

  function renderItem(key: WorkspaceItemKey, grouped: boolean): HTMLElement | null {
    if (!workspace) return null;
    const indexed = memberForKey(key, workspace, memberIndex);
    const parsed = parseItemKey(key);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "admin-workspace-item";
    btn.dataset.workspaceKey = key;
    const activeKey = callbacks.getActiveKey();
    if (activeKey === key) btn.classList.add("is-active");

    const member = indexed?.member;
    const title = member
      ? titleForMember(member, projectMap(projects), listMap(lists))
      : parsed?.kind === "project"
        ? projectMap(projects).get(parsed.id)?.title ?? "项目"
        : "条目";
    const icon = member ? iconForMember(member) : PROJECT_ICON;
    const missingPath = member?.memberKind === "link" && member.linkKind !== "bookmark" && !member.localPath;
    if (missingPath) btn.classList.add("is-missing-target");

    btn.innerHTML = `<span class="admin-workspace-item-icon">${icon}</span><span class="admin-workspace-item-label">${escapeHtml(title)}</span>`;
    if (!btn.dataset.dragWired) {
      btn.dataset.dragWired = "1";
      attachIdentityDragSource(btn, () => {
        if (!parsed) return null;
        if (parsed.kind === "project") {
          return { identity: { kind: "project", id: parsed.id }, title };
        }
        if (parsed.kind === "list") {
          return { identity: { kind: "task-view" }, title: "任务", taskFilter: parsed.id };
        }
        if (parsed.kind === "journal") {
          const entryId = member?.objectId ?? parsed.id;
          return { identity: { kind: "journal", id: entryId }, title };
        }
        return null;
      }, ac.signal);
    }
    btn.addEventListener("click", () => {
      if (!parsed) return;
      if (parsed.kind === "project") callbacks.onSelectProject(parsed.id);
      else if (parsed.kind === "list") callbacks.onSelectList(parsed.id);
      else if (parsed.kind === "link" && member) void openLinkMember(member);
    });
    btn.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      if (!parsed || !indexed) {
        if (parsed?.kind === "project") {
          showCommandMenuAt(e.clientX, e.clientY, [{ value: "delete-project", label: "删除项目", danger: true }], (action) => {
            if (action === "delete-project") callbacks.onDeleteProject?.(parsed.id);
          });
        }
        return;
      }
      const groupItems = state.groups.map((g) => ({
        action: `group:${g.id}`,
        label: `移到「${g.title}」`,
      }));
      const menuItems: { action: string; label: string; danger?: boolean }[] = [
        ...groupItems,
        { action: "ungroup", label: "移出分组" },
        { action: "new-group", label: "新建分组并移入" },
      ];
      if (parsed.kind === "project") {
        menuItems.push({ action: "delete-project", label: "删除项目", danger: true });
      } else if (parsed.kind === "list") {
        menuItems.push({ action: "remove-list", label: "从工作区移除", danger: true });
      } else if (parsed.kind === "link") {
        menuItems.length = 0;
        menuItems.push(
          { action: "rename-link", label: "重命名" },
          { action: "rebind-link", label: "重新指定路径" },
          { action: "delete-link", label: "删除链接", danger: true },
        );
        if (member.linkKind === "bookmark" && member.linkUrl) {
          menuItems.unshift({ action: "open-link", label: "打开" });
        } else if (member.localPath) {
          menuItems.unshift({ action: "open-link", label: "打开" });
        }
      } else if (parsed.kind === "journal") {
        menuItems.length = 0;
        menuItems.push({ action: "remove-journal", label: "从工作区移除", danger: true });
      }
      if (indexed.containerId === workspace.root.id) {
        const rootMembers = [...workspace.root.members].sort((a, b) => a.position - b.position);
        const rootIdx = rootMembers.findIndex((m) => m.id === indexed.member.id);
        const reorderItems: { action: string; label: string }[] = [];
        if (rootIdx > 0) reorderItems.push({ action: "move-up", label: "上移" });
        if (rootIdx >= 0 && rootIdx < rootMembers.length - 1) {
          reorderItems.push({ action: "move-down", label: "下移" });
        }
        menuItems.unshift(...reorderItems);
      }
      showCommandMenuAt(
        e.clientX,
        e.clientY,
        menuItems.map((item) => ({ value: item.action, label: item.label, danger: item.danger })),
        (action) => {
        if (action === "ungroup") void moveMemberToGroup(key, null);
        else if (action === "new-group") void createGroupAndMove(key);
        else if (action === "delete-project" && parsed.kind === "project") {
          callbacks.onDeleteProject?.(parsed.id);
        } else if (action.startsWith("group:")) void moveMemberToGroup(key, action.slice(6));
        else if (action === "remove-list") void removeListMember(indexed);
        else if (action === "open-link") void openLinkMember(member);
        else if (action === "rebind-link") void rebindLinkMember(indexed);
        else if (action === "rename-link") void renameLinkMember(indexed);
        else if (action === "delete-link") void deleteLinkMember(indexed);
        else if (action === "remove-journal") void removeJournalMember(indexed);
        else if (action === "move-up") void moveRootMember(indexed.member.id, "up");
        else if (action === "move-down") void moveRootMember(indexed.member.id, "down");
        },
      );
    });
    if (grouped) btn.classList.add("is-grouped-item");
    return btn;
  }

  async function removeListMember(indexed: IndexedMember): Promise<void> {
    await applyMutation(() =>
      workspaceRemoveList({
        container: { id: indexed.containerId, expectedRevision: indexed.containerRevision },
        member: { id: indexed.member.id },
      }),
    );
  }

  async function deleteLinkMember(indexed: IndexedMember): Promise<void> {
    await applyMutation(() =>
      workspaceDeleteLink({
        container: { id: indexed.containerId, expectedRevision: indexed.containerRevision },
        member: { id: indexed.member.id },
        memberExpectedRevision: indexed.member.revision,
      }),
    );
  }

  async function renameLinkMember(indexed: IndexedMember): Promise<void> {
    const title = await getNamePromptDialog()("重命名链接", {
      label: "名称",
      submitLabel: "保存",
      initial: indexed.member.linkTitle ?? "",
    });
    if (!title) return;
    await applyMutation(() =>
      workspaceRenameLink({
        container: { id: indexed.containerId, expectedRevision: indexed.containerRevision },
        member: { id: indexed.member.id },
        memberExpectedRevision: indexed.member.revision,
        linkTitle: title,
      }),
    );
  }

  async function removeJournalMember(indexed: IndexedMember): Promise<void> {
    const entryId = indexed.member.objectId;
    if (!entryId) return;
    await applyMutation(async () => {
      const entryRes = await journalArchiveGetEntry(entryId);
      return workspaceDeleteJournalDocument({
        entry: { id: entryId, expectedRevision: entryRes.entry.revision },
        container: { id: indexed.containerId, expectedRevision: indexed.containerRevision },
        member: { id: indexed.member.id },
      });
    });
  }

  function renderGroup(group: WorkspaceResponse["groups"][number], itemsEl: HTMLElement): void {
    const local = state.groups.find((g) => g.id === group.id);
    const collapsed = local?.collapsed ?? false;
    const wrap = document.createElement("div");
    wrap.className = "admin-workspace-group";
    wrap.dataset.groupId = group.id;
    const header = document.createElement("div");
    header.className = "admin-workspace-group-header";
    header.innerHTML = `
      <button type="button" class="admin-workspace-group-toggle" aria-label="${collapsed ? "展开" : "收起"}">${COLLAPSE_ICON}</button>
      <span class="admin-workspace-group-title">${escapeHtml(group.title)}</span>`;
    const toggle = header.querySelector<HTMLButtonElement>(".admin-workspace-group-toggle")!;
    if (collapsed) toggle.style.transform = "rotate(-90deg)";
    toggle.addEventListener("click", () => setGroupCollapsed(group.id, !collapsed));
    header.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      showCommandMenuAt(
        e.clientX,
        e.clientY,
        [
          { value: "rename-group", label: "重命名" },
          { value: "delete-group", label: "删除分组", danger: true },
        ],
        (action) => {
          if (action === "rename-group") void renameGroup(group.id, group.title);
          else if (action === "delete-group") void deleteGroup(group);
        },
      );
    });
    wrap.appendChild(header);
    const list = document.createElement("div");
    list.className = "admin-workspace-items is-grouped";
    if (!collapsed) {
      for (const member of group.members) {
        const key = memberToItemKey(member);
        if (!key) continue;
        const el = renderItem(key, true);
        if (el) list.appendChild(el);
      }
    }
    wrap.appendChild(list);
    itemsEl.appendChild(wrap);
  }

  function render(): void {
    if (disposed) return;
    syncFromCache();
    if (!workspace) {
      container.innerHTML = `<p class="admin-placeholder-hint">加载工作区…</p>`;
      return;
    }

    container.innerHTML = `
      <div class="admin-workspace-actions">
        <button type="button" class="admin-workspace-btn" data-action="new-project">
          <span class="admin-workspace-btn-label">新建项目</span>
        </button>
        <button type="button" class="admin-workspace-btn" data-action="new-group">
          <span class="admin-workspace-btn-label">新建分组</span>
        </button>
        <button type="button" class="admin-workspace-btn" data-action="add-journal">
          <span class="admin-workspace-btn-label">添加日记</span>
        </button>
        <button type="button" class="admin-workspace-btn" data-action="new-link">
          <span class="admin-workspace-btn-label">新建链接</span>
        </button>
      </div>
      <div class="admin-workspace-items" data-region="items"></div>`;

    container.querySelector<HTMLButtonElement>('[data-action="new-project"]')?.addEventListener("click", () => {
      void createProject();
    });
    container.querySelector<HTMLButtonElement>('[data-action="new-group"]')?.addEventListener("click", () => {
      void createGroup();
    });
    container.querySelector<HTMLButtonElement>('[data-action="add-journal"]')?.addEventListener("click", () => {
      void addJournalDocument();
    });
    container.querySelector<HTMLButtonElement>('[data-action="new-link"]')?.addEventListener("click", () => {
      void createExternalLink();
    });

    const itemsEl = container.querySelector<HTMLElement>('[data-region="items"]')!;
    const sortedGroups = [...workspace.groups].sort((a, b) => a.rootPosition - b.rootPosition);
    for (const group of sortedGroups) renderGroup(group, itemsEl);

    for (const member of workspace.root.members) {
      const key = memberToItemKey(member);
      if (!key) continue;
      const el = renderItem(key, false);
      if (el) itemsEl.appendChild(el);
    }

    const placed = placedProjectIds(workspace);
    for (const project of projects) {
      if (placed.has(project.id)) continue;
      const key = itemKey("project", project.id);
      const el = renderItem(key, false);
      if (el) itemsEl.appendChild(el);
    }

    updateActive();
  }

  async function createProject(): Promise<void> {
    const title = await getNamePromptDialog()("新建项目", { label: "项目名称", submitLabel: "创建" });
    if (!title) return;
    try {
      const res = await productivityCreateProject({ title, status: "规划中" });
      await refresh();
      callbacks.onSelectProject(res.project.id);
    } catch {
      /* noop */
    }
  }

  async function createGroup(): Promise<void> {
    const title = await getNamePromptDialog()("新建分组", { label: "分组名称", submitLabel: "创建" });
    if (!title || !workspace) return;
    await applyMutation(() =>
      workspaceCreateGroup({
        title,
        root: { id: workspace!.root.id, expectedRevision: workspace!.root.revision },
      }),
    );
  }

  async function createGroupAndMove(key: WorkspaceItemKey): Promise<void> {
    const title = await getNamePromptDialog()("新建分组", { label: "分组名称", submitLabel: "创建" });
    if (!title || !workspace) return;
    const indexed = memberForKey(key, workspace, memberIndex);
    const ok = await applyMutation(() =>
      workspaceCreateGroup({
        title,
        root: { id: workspace!.root.id, expectedRevision: workspace!.root.revision },
      }),
    );
    if (!ok || !indexed) return;
    syncFromCache();
    const fresh = getWorkspaceResponse();
    if (!fresh) return;
    const newGroup = [...fresh.groups].sort((a, b) => b.rootPosition - a.rootPosition)[0];
    if (!newGroup) return;
    const freshIndexed = indexWorkspaceMembers(fresh).get(indexed.member.id);
    if (!freshIndexed) return;
    await applyMutation(() =>
      workspaceMoveMember({
        memberId: freshIndexed.member.id,
        source: {
          id: freshIndexed.containerId,
          expectedRevision: freshIndexed.containerRevision,
        },
        target: { id: newGroup.id, expectedRevision: newGroup.revision },
      }),
    );
  }

  async function renameGroup(groupId: string, currentTitle: string): Promise<void> {
    if (!workspace) return;
    const group = workspace.groups.find((g) => g.id === groupId);
    if (!group) return;
    const title = await getNamePromptDialog()("重命名分组", {
      label: "分组名称",
      submitLabel: "保存",
      initial: currentTitle,
    });
    if (!title) return;
    await applyMutation(() =>
      workspaceRenameGroup({
        group: { id: groupId, expectedRevision: group.revision },
        title,
      }),
    );
  }

  async function deleteGroup(group: WorkspaceResponse["groups"][number]): Promise<void> {
    if (!workspace) return;
    await applyMutation(() =>
      workspaceDeleteGroup({
        group: { id: group.id, expectedRevision: group.revision },
        root: { id: workspace!.root.id, expectedRevision: workspace!.root.revision },
        expectedMembers: group.members.map((m) => ({ id: m.id })),
      }),
    );
  }

  async function createExternalLink(): Promise<void> {
    if (!workspace) return;
    const title = await getNamePromptDialog()("新建链接", { label: "标题", submitLabel: "创建" });
    if (!title) return;
    const url = await getNamePromptDialog()("新建链接", { label: "URL", submitLabel: "创建" });
    if (!url) return;
    await applyMutation(() =>
      workspaceCreateLink({
        container: { id: workspace!.root.id, expectedRevision: workspace!.root.revision },
        linkKind: "bookmark",
        linkTitle: title,
        linkUrl: url,
      }),
    );
  }

  async function addJournalDocument(): Promise<void> {
    if (!workspace) return;
    const entryId = await getNamePromptDialog()("添加日记文档", {
      label: "文档 ID",
      submitLabel: "添加",
    });
    if (!entryId?.trim()) return;
    const id = entryId.trim();
    await applyMutation(async () => {
      const entryRes = await journalArchiveGetEntry(id);
      return workspaceAddJournalDocument({
        entry: { id, expectedRevision: entryRes.entry.revision },
        container: { id: workspace!.root.id, expectedRevision: workspace!.root.revision },
      });
    });
  }

  async function refresh(): Promise<void> {
    if (disposed) return;
    try {
      const [pRes, lRes] = await Promise.all([
        productivityListProjects(),
        productivityListLists(),
        reloadWorkspaceFromServer(),
      ]);
      if (disposed) return;
      projects = liveProjects(pRes.projects);
      lists = liveLists(lRes.lists);
      syncFromCache();
      render();
    } catch {
      render();
    }
  }

  function updateActive(): void {
    const activeKey = callbacks.getActiveKey();
    container.querySelectorAll<HTMLElement>(".admin-workspace-item").forEach((el) => {
      el.classList.toggle("is-active", el.dataset.workspaceKey === activeKey);
    });
  }

  void refresh();

  return {
    refresh,
    updateActive,
    dispose() {
      disposed = true;
      ac.abort();
      window.removeEventListener("orbita-workspace-refresh", onRefresh);
      container.innerHTML = "";
    },
  };
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
