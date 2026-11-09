import { getSettings } from "../../core/settings";
import { productivityGetList } from "../productivity/client";
import type { MemberSnapshot, WorkspaceResponse } from "../workspace/client";
import {
  workspaceAddList,
  workspaceList,
  workspaceRemoveList,
} from "../workspace/client";

const DEVICE_ID_KEY = "orbita.deviceId";
const COLLAPSE_PREFIX = "orbita.insight.workspace-nav.collapse.";

export type WorkspaceItemKey =
  | `project:${string}`
  | `list:${string}`
  | `link:${string}`
  | `journal:${string}`;

export type WorkspaceGroup = {
  id: string;
  title: string;
  collapsed: boolean;
};

export type WorkspaceNavState = {
  groups: WorkspaceGroup[];
  groupOrder: string[];
  membership: Record<string, string | null>;
  pinnedListIds: string[];
  ungroupedOrder: WorkspaceItemKey[];
};

let workspaceCache: WorkspaceResponse | null = null;
let derivedState: WorkspaceNavState = emptyState();

export function itemKey(
  kind: "project" | "list" | "link" | "journal",
  id: string,
): WorkspaceItemKey {
  return `${kind}:${id}`;
}

export function parseItemKey(
  key: string,
): { kind: "project" | "list" | "link" | "journal"; id: string } | null {
  const idx = key.indexOf(":");
  if (idx < 1) return null;
  const kind = key.slice(0, idx);
  if (kind !== "project" && kind !== "list" && kind !== "link" && kind !== "journal") return null;
  return { kind, id: key.slice(idx + 1) };
}

export function getDeviceId(): string {
  try {
    const existing = localStorage.getItem(DEVICE_ID_KEY);
    if (existing) return existing;
    const id = crypto.randomUUID();
    localStorage.setItem(DEVICE_ID_KEY, id);
    return id;
  } catch {
    return "local-device";
  }
}

function collapseStorageKey(): string {
  const dir = getSettings().dataDir || "_default";
  return `${COLLAPSE_PREFIX}${dir}`;
}

function loadCollapsedMap(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(collapseStorageKey());
    if (!raw) return {};
    const parsed = JSON.parse(raw) as { collapsed?: Record<string, boolean> };
    return parsed?.collapsed ?? {};
  } catch {
    return {};
  }
}

function saveCollapsedMap(collapsed: Record<string, boolean>): void {
  try {
    localStorage.setItem(collapseStorageKey(), JSON.stringify({ collapsed }));
  } catch {
    /* quota */
  }
}

function emptyState(): WorkspaceNavState {
  return { groups: [], groupOrder: [], membership: {}, pinnedListIds: [], ungroupedOrder: [] };
}

export function memberToItemKey(member: MemberSnapshot): WorkspaceItemKey | null {
  if (member.memberKind === "link") return itemKey("link", member.id);
  if (member.memberKind === "journal_document" && member.objectId) {
    return itemKey("journal", member.objectId);
  }
  if (member.memberKind === "project" && member.objectId) {
    return itemKey("project", member.objectId);
  }
  if (member.memberKind === "list" && member.objectId) {
    return itemKey("list", member.objectId);
  }
  return null;
}

function deriveStateFromResponse(res: WorkspaceResponse): WorkspaceNavState {
  const collapsed = loadCollapsedMap();
  const groups = [...res.groups]
    .sort((a, b) => a.rootPosition - b.rootPosition)
    .map((g) => ({
      id: g.id,
      title: g.title,
      collapsed: collapsed[g.id] ?? false,
    }));
  const groupOrder = groups.map((g) => g.id);
  const membership: Record<string, string | null> = {};
  const pinnedListIds: string[] = [];
  const ungroupedOrder: WorkspaceItemKey[] = [];

  for (const member of res.root.members) {
    const key = memberToItemKey(member);
    if (!key) continue;
    membership[key] = null;
    ungroupedOrder.push(key);
    if (member.memberKind === "list" && member.objectId) {
      pinnedListIds.push(member.objectId);
    }
  }

  for (const group of res.groups) {
    for (const member of group.members) {
      const key = memberToItemKey(member);
      if (!key) continue;
      membership[key] = group.id;
      if (member.memberKind === "list" && member.objectId) {
        pinnedListIds.push(member.objectId);
      }
    }
  }

  return { groups, groupOrder, membership, pinnedListIds, ungroupedOrder };
}

export function getWorkspaceResponse(): WorkspaceResponse | null {
  return workspaceCache;
}

export function applyWorkspaceResponse(res: WorkspaceResponse): WorkspaceNavState {
  workspaceCache = res;
  derivedState = deriveStateFromResponse(res);
  return derivedState;
}

export async function reloadWorkspaceFromServer(): Promise<WorkspaceNavState> {
  const res = await workspaceList({ deviceId: getDeviceId() });
  return applyWorkspaceResponse(res);
}

export function loadWorkspaceNav(): WorkspaceNavState {
  return derivedState;
}

export function saveWorkspaceNav(state: WorkspaceNavState): void {
  derivedState = state;
  const collapsed: Record<string, boolean> = {};
  for (const g of state.groups) {
    collapsed[g.id] = g.collapsed;
  }
  saveCollapsedMap(collapsed);
}

function isLiveKey(
  key: string,
  liveProjectIds: ReadonlySet<string>,
  liveListIds: ReadonlySet<string>,
): boolean {
  const parsed = parseItemKey(key);
  if (!parsed) return false;
  if (parsed.kind === "project") return liveProjectIds.has(parsed.id);
  if (parsed.kind === "list") return liveListIds.has(parsed.id);
  return parsed.kind === "link" || parsed.kind === "journal";
}

export function sanitizeWorkspaceNav(
  state: WorkspaceNavState,
  liveProjectIds: ReadonlySet<string>,
  liveListIds: ReadonlySet<string>,
): WorkspaceNavState {
  const groupIds = new Set(state.groups.map((g) => g.id));
  const groups = state.groups.filter((g) => g.id);
  const groupOrder = state.groupOrder.filter((id) => groupIds.has(id));
  for (const g of groups) {
    if (!groupOrder.includes(g.id)) groupOrder.push(g.id);
  }

  const pinnedListIds = state.pinnedListIds.filter((id) => liveListIds.has(id));
  const membership: Record<string, string | null> = {};
  for (const [key, groupId] of Object.entries(state.membership)) {
    if (!isLiveKey(key, liveProjectIds, liveListIds)) continue;
    membership[key] = groupId && groupIds.has(groupId) ? groupId : null;
  }

  const ungroupedOrder = state.ungroupedOrder.filter((key) =>
    isLiveKey(key, liveProjectIds, liveListIds),
  );

  return { groups, groupOrder, membership, pinnedListIds, ungroupedOrder };
}

export function isListPinned(state: WorkspaceNavState, listId: string): boolean {
  return state.pinnedListIds.includes(listId);
}

function findListMember(listId: string): { member: MemberSnapshot; containerId: string } | null {
  if (!workspaceCache) return null;
  for (const member of workspaceCache.root.members) {
    if (member.memberKind === "list" && member.objectId === listId) {
      return { member, containerId: workspaceCache.root.id };
    }
  }
  for (const group of workspaceCache.groups) {
    for (const member of group.members) {
      if (member.memberKind === "list" && member.objectId === listId) {
        return { member, containerId: group.id };
      }
    }
  }
  return null;
}

function containerRevision(containerId: string): number | null {
  if (!workspaceCache) return null;
  if (workspaceCache.root.id === containerId) return workspaceCache.root.revision;
  return workspaceCache.groups.find((g) => g.id === containerId)?.revision ?? null;
}

async function commitListPin(listId: string, pin: boolean): Promise<void> {
  if (!workspaceCache) {
    await reloadWorkspaceFromServer();
    return;
  }
  try {
    if (pin) {
      const listRes = await productivityGetList({ id: listId });
      const res = await workspaceAddList({
        list: { id: listId, expectedRevision: listRes.list.revision },
        container: {
          id: workspaceCache.root.id,
          expectedRevision: workspaceCache.root.revision,
        },
      });
      applyWorkspaceResponse(res);
    } else {
      const found = findListMember(listId);
      if (!found) return;
      const rev = containerRevision(found.containerId);
      if (rev == null) return;
      const res = await workspaceRemoveList({
        container: { id: found.containerId, expectedRevision: rev },
        member: { id: found.member.id },
      });
      applyWorkspaceResponse(res);
    }
    window.dispatchEvent(new Event("orbita-workspace-refresh"));
  } catch (e) {
    alert(String(e));
    await reloadWorkspaceFromServer();
    window.dispatchEvent(new Event("orbita-workspace-refresh"));
  }
}

export function toggleListPinned(state: WorkspaceNavState, listId: string): WorkspaceNavState {
  const pinned = state.pinnedListIds.includes(listId);
  const key = itemKey("list", listId);
  let { membership, ungroupedOrder, pinnedListIds } = state;
  if (!pinned) {
    pinnedListIds = [...pinnedListIds, listId];
    if (!membership[key] && !ungroupedOrder.includes(key)) {
      ungroupedOrder = [...ungroupedOrder, key];
    }
  } else {
    pinnedListIds = pinnedListIds.filter((id) => id !== listId);
    const { [key]: _, ...rest } = membership;
    membership = rest;
    ungroupedOrder = ungroupedOrder.filter((k) => k !== key);
  }
  void commitListPin(listId, !pinned);
  return { ...state, pinnedListIds, membership, ungroupedOrder };
}

export type IndexedMember = {
  member: MemberSnapshot;
  containerId: string;
  containerRevision: number;
};

export function indexWorkspaceMembers(res: WorkspaceResponse): Map<string, IndexedMember> {
  const map = new Map<string, IndexedMember>();
  for (const member of res.root.members) {
    map.set(member.id, {
      member,
      containerId: res.root.id,
      containerRevision: res.root.revision,
    });
  }
  for (const group of res.groups) {
    for (const member of group.members) {
      map.set(member.id, {
        member,
        containerId: group.id,
        containerRevision: group.revision,
      });
    }
  }
  return map;
}

export function keyToMemberId(res: WorkspaceResponse, key: WorkspaceItemKey): string | null {
  const parsed = parseItemKey(key);
  if (!parsed) return null;
  if (parsed.kind === "link") return parsed.id;
  const all = [...res.root.members, ...res.groups.flatMap((g) => g.members)];
  for (const member of all) {
    const mk = memberToItemKey(member);
    if (mk === key) return member.id;
  }
  return null;
}
