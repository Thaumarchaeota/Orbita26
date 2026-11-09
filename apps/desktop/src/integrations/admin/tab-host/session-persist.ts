import {
  contentTabKey,
  destForIdentity,
  destStateForIdentity,
  httpWebIdentity,
  type ActiveSurface,
  type ContentTabIdentity,
  type ContentTabRecord,
  type FixedDestId,
  type LeftPaneActive,
  type PaneState,
  type WorkspacePanes,
} from "./identity";

const STORAGE_KEY = "orbita.insight.tab-session";

export type TabStripStyle = "rect" | "trap";

export type PaneSnapshot = {
  tabKeys: string[];
  active: string;
  width: number;
};

export type TabSessionV1 = {
  v: 1;
  tabs: ContentTabRecord[];
  active: ActiveSurface;
  style: TabStripStyle;
};

export type TabSession = {
  v: 2;
  tabs: ContentTabRecord[];
  panes: {
    left: PaneSnapshot;
    right?: PaneSnapshot;
  };
  focusedPane: "left" | "right";
  style: TabStripStyle;
};

const FIXED_DESTS = new Set<FixedDestId>(["timeline", "work", "health", "finance", "finance1"]);

function parseIdentity(raw: unknown): ContentTabIdentity | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (o.kind === "settings") return { kind: "settings" };
  if (o.kind === "health-page" && (o.page === "activities" || o.page === "intake")) {
    return { kind: "health-page", page: o.page };
  }
  if (o.kind === "control-gallery") return { kind: "control-gallery" };
  if (o.kind === "color-lab" || o.kind === "category-palette") return { kind: "settings" };
  if (o.kind === "blank" && typeof o.id === "string" && o.id.length > 0) {
    return { kind: "blank", id: o.id };
  }
  if (o.kind === "fixed" && typeof o.dest === "string" && FIXED_DESTS.has(o.dest as FixedDestId)) {
    return { kind: "fixed", dest: o.dest as FixedDestId };
  }
  if (o.kind === "project-index") return { kind: "project-index" };
  if (o.kind === "task-view") return { kind: "task-view" };
  if (o.kind === "project" && typeof o.id === "string" && o.id.length > 0) {
    return { kind: "project", id: o.id };
  }
  if (o.kind === "list" && typeof o.id === "string" && o.id.length > 0) {
    return { kind: "list", id: o.id };
  }
  if (o.kind === "chat" && typeof o.id === "string" && o.id.length > 0) {
    return { kind: "chat", id: o.id };
  }
  if (o.kind === "meal" && typeof o.id === "string" && o.id.length > 0) {
    return { kind: "meal", id: o.id };
  }
  if (o.kind === "journal" && typeof o.id === "string" && o.id.length > 0) {
    return { kind: "journal", id: o.id };
  }
  if (o.kind === "web" && typeof o.url === "string" && o.url.length > 0) {
    return httpWebIdentity(o.url);
  }
  return null;
}

function taskViewFilterDestState(rawDestState: unknown): unknown {
  if (!rawDestState || typeof rawDestState !== "object") return { view: "week" };
  const state = rawDestState as Record<string, unknown>;
  if (state.view === "week") return { view: "week" };
  const rawFilter = typeof state.filter === "string" && state.filter.length > 0 ? state.filter : "all";
  if (state.view === "list") return { view: "list", filter: rawFilter };
  // Older list tabs stored only a concrete filter; an empty legacy state now opens the default week.
  if (state.filter && typeof state.filter === "string") return { view: "list", filter: rawFilter };
  return { view: "week" };
}

export function sanitizeTabRecord(raw: unknown): ContentTabRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const identity = parseIdentity(o.identity);
  if (!identity) return null;
  if (typeof o.key !== "string" || o.key.length === 0) return null;
  const rawIdentity = o.identity as Record<string, unknown> | null;
  const legacyColorIdentity = rawIdentity?.kind === "color-lab" || rawIdentity?.kind === "category-palette";
  const title = legacyColorIdentity ? "设置" : typeof o.title === "string" ? o.title : "";
  const rawState = o.destState && typeof o.destState === "object" ? o.destState as Record<string, unknown> : {};
  const requestedTab = rawState.tab;
  const destState = legacyColorIdentity
    ? { tab: "color-management" }
    : identity.kind === "settings"
      ? { tab: requestedTab === "appearance" || requestedTab === "temporary" || requestedTab === "color-management" ? requestedTab : "general" }
      : identity.kind === "task-view"
        ? taskViewFilterDestState(o.destState)
        : destStateForIdentity(identity);
  return {
    key: legacyColorIdentity ? contentTabKey(identity) : o.key,
    identity,
    title,
    destId: destForIdentity(identity),
    destState,
  };
}

function legacyColorKeyAliases(rawTabs: unknown): Map<string, string> {
  const aliases = new Map<string, string>();
  if (!Array.isArray(rawTabs)) return aliases;
  for (const item of rawTabs) {
    if (!item || typeof item !== "object") continue;
    const tab = item as Record<string, unknown>;
    const identity = tab.identity as Record<string, unknown> | null;
    if ((identity?.kind === "color-lab" || identity?.kind === "category-palette") && typeof tab.key === "string") aliases.set(tab.key, "settings");
  }
  return aliases;
}

function restoreColorManagementForActiveLegacy(rawTabs: unknown, activeKeys: readonly unknown[]): boolean {
  const aliases = legacyColorKeyAliases(rawTabs);
  return activeKeys.some((key) => typeof key === "string" && aliases.has(key));
}

export function sanitizeActiveSurface(raw: unknown, tabKeys: ReadonlySet<string>): ActiveSurface {
  if (!raw || typeof raw !== "object") return { type: "home" };
  const o = raw as Record<string, unknown>;
  if (o.type === "home") return { type: "home" };
  if (o.type === "fixed" && typeof o.dest === "string" && FIXED_DESTS.has(o.dest as FixedDestId)) {
    return { type: "fixed", dest: o.dest as FixedDestId };
  }
  if (o.type === "content" && typeof o.key === "string" && tabKeys.has(o.key)) {
    return { type: "content", key: o.key };
  }
  return { type: "home" };
}

function parseStyle(raw: unknown): TabStripStyle {
  return raw === "trap" ? "trap" : "rect";
}

function legacyFixedDestForContentKey(
  key: string,
  rawTabs: unknown,
): FixedDestId | null {
  if (!Array.isArray(rawTabs)) return null;
  for (const item of rawTabs) {
    const tab = sanitizeTabRecord(item);
    if (!tab || tab.key !== key || tab.identity.kind !== "fixed") continue;
    return tab.identity.dest;
  }
  return null;
}

function mergeLegacyTaskTab(rawTabs: unknown, rawActive: unknown): ContentTabRecord | null {
  if (!Array.isArray(rawTabs)) return null;

  let key = "task-view";
  let title = "安排";
  let sawTask = false;
  let existingTaskViewState: { view: "week" | "list"; filter?: string } | undefined;
  let activeType: string | undefined;
  let activeContentKey: string | undefined;
  let activeFixedDest: string | undefined;

  if (rawActive && typeof rawActive === "object") {
    const a = rawActive as Record<string, unknown>;
    activeType = typeof a.type === "string" ? a.type : undefined;
    if (a.type === "content" && typeof a.key === "string") {
      activeContentKey = a.key;
    }
    if (a.type === "fixed" && typeof a.dest === "string") {
      activeFixedDest = a.dest;
    }
  }

  for (const item of rawTabs) {
    const tab = sanitizeTabRecord(item);
    if (!tab) continue;
    const { identity } = tab;

    if (identity.kind === "task-view") {
      sawTask = true;
      key = tab.key;
      if (tab.title) title = tab.title;
      existingTaskViewState = tab.destState as { view: "week" | "list"; filter?: string };
    } else if (identity.kind === "fixed" && identity.dest === "work") {
      sawTask = true;
      if (key === "task-view") key = tab.key;
      if (tab.title) title = tab.title;
    } else if (identity.kind === "list") {
      sawTask = true;
      if (key === "task-view") key = tab.key;
    }
  }

  if (!sawTask) return null;

  let state = existingTaskViewState;

  if (activeContentKey) {
    for (const item of rawTabs) {
      const tab = sanitizeTabRecord(item);
      if (!tab || tab.key !== activeContentKey) continue;
      if (tab.identity.kind === "list") {
        key = tab.key;
        state = { view: "list", filter: tab.identity.id };
      } else if (tab.identity.kind === "task-view") {
        key = tab.key;
      } else if (tab.identity.kind === "fixed" && tab.identity.dest === "work") {
        key = tab.key;
        state ??= { view: "week" };
      }
      break;
    }
  } else if (
    activeType === "home" ||
    (activeType === "fixed" && activeFixedDest !== undefined)
  ) {
    state ??= { view: "week" };
  }

  const destState = state ?? { view: "week" };

  return {
    key,
    identity: { kind: "task-view" },
    title,
    destId: "work",
    destState,
  };
}

function isMergedTaskLegacyIdentity(identity: ContentTabIdentity): boolean {
  return (
    identity.kind === "task-view" ||
    identity.kind === "list" ||
    (identity.kind === "fixed" && identity.dest === "work")
  );
}

function remapActiveContentKey(
  activeKey: string,
  rawTabs: unknown,
  taskKey: string,
): ActiveSurface {
  if (activeKey === taskKey) return { type: "content", key: taskKey };
  if (!Array.isArray(rawTabs)) return { type: "content", key: activeKey };
  for (const item of rawTabs) {
    const tab = sanitizeTabRecord(item);
    if (!tab || tab.key !== activeKey) continue;
    if (isMergedTaskLegacyIdentity(tab.identity)) {
      return { type: "content", key: taskKey };
    }
  }
  return { type: "content", key: activeKey };
}

function activeSurfaceToLeftActive(active: ActiveSurface, tabKeys: ReadonlySet<string>): LeftPaneActive {
  if (active.type === "home") return "home";
  if (active.type === "fixed" && active.dest === "timeline") return "timeline";
  if (active.type === "fixed") return `fixed:${active.dest}`;
  if (active.type === "content" && tabKeys.has(active.key)) return active.key;
  return "home";
}

function sanitizePaneSnapshot(
  raw: unknown,
  tabKeys: ReadonlySet<string>,
  fallbackActive: LeftPaneActive,
  aliases: ReadonlyMap<string, string> = new Map(),
): PaneSnapshot {
  if (!raw || typeof raw !== "object") {
    return { tabKeys: [...tabKeys], active: fallbackActive, width: 0 };
  }
  const o = raw as Record<string, unknown>;
  const keys: string[] = [];
  if (Array.isArray(o.tabKeys)) {
    for (const k of o.tabKeys) {
      if (typeof k === "string") {
        const normalized = aliases.get(k) ?? k;
        if (tabKeys.has(normalized) && !keys.includes(normalized)) keys.push(normalized);
      }
    }
  }
  let active = typeof o.active === "string" ? o.active : fallbackActive;
  active = aliases.get(active) ?? active;
  const fixedDest = active.startsWith("fixed:") ? active.slice("fixed:".length) : "";
  const isAllowedFixedActive = FIXED_DESTS.has(fixedDest as FixedDestId);
  if (active !== "home" && active !== "timeline" && !isAllowedFixedActive && !tabKeys.has(active)) {
    active = keys[0] ?? fallbackActive;
  }
  const width = typeof o.width === "number" && o.width >= 0 ? o.width : 0;
  return { tabKeys: keys, active, width };
}

function v1ToV2(v1: TabSessionV1): TabSession {
  const tabKeys = new Set(v1.tabs.map((t) => t.key));
  const leftActive = activeSurfaceToLeftActive(v1.active, tabKeys);
  return {
    v: 2,
    tabs: v1.tabs,
    panes: {
      left: {
        tabKeys: v1.tabs.map((t) => t.key),
        active: leftActive,
        width: 0,
      },
    },
    focusedPane: "left",
    style: v1.style,
  };
}

function sanitizeV1TabSession(raw: Record<string, unknown>): TabSessionV1 {
  const rawTabs = raw.tabs;
  const aliases = legacyColorKeyAliases(rawTabs);
  const inputActive = raw.active;
  const rawActive = (() => {
    if (!inputActive || typeof inputActive !== "object") return inputActive;
    const active = inputActive as Record<string, unknown>;
    if (active.type === "content" && typeof active.key === "string" && aliases.has(active.key)) return { type: "content", key: aliases.get(active.key) };
    return inputActive;
  })();
  const focusColorManagement = restoreColorManagementForActiveLegacy(rawTabs, [
    inputActive && typeof inputActive === "object" ? (inputActive as Record<string, unknown>).key : null,
  ]);
  const mergedTask = mergeLegacyTaskTab(rawTabs, rawActive);

  const tabs: ContentTabRecord[] = [];
  const seenKeys = new Set<string>();
  const seenIdentities = new Set<string>();
  if (Array.isArray(rawTabs)) {
    for (const item of rawTabs) {
      const tab = sanitizeTabRecord(item);
      if (!tab || seenKeys.has(tab.key)) continue;
      if (tab.identity.kind === "fixed") continue;
      if (isMergedTaskLegacyIdentity(tab.identity)) continue;
      const identityKey = contentTabKey(tab.identity);
      if (seenIdentities.has(identityKey)) continue;
      seenKeys.add(tab.key);
      seenIdentities.add(identityKey);
      tabs.push(tab);
    }
  }

  if (mergedTask && !seenKeys.has(mergedTask.key) && !seenIdentities.has("task-view")) {
    seenKeys.add(mergedTask.key);
    seenIdentities.add("task-view");
    tabs.push(mergedTask);
  }
  if (focusColorManagement) {
    const settings = tabs.find((tab) => tab.identity.kind === "settings");
    if (settings) settings.destState = { tab: "color-management" };
  }

  const tabKeys = new Set(tabs.map((t) => t.key));
  let active: ActiveSurface;
  if (
    rawActive &&
    typeof rawActive === "object" &&
    (rawActive as Record<string, unknown>).type === "fixed" &&
    typeof (rawActive as Record<string, unknown>).dest === "string" &&
    FIXED_DESTS.has((rawActive as Record<string, unknown>).dest as FixedDestId)
  ) {
    const dest = (rawActive as Record<string, unknown>).dest as FixedDestId;
    if (dest === "work" && mergedTask) {
      active = { type: "content", key: mergedTask.key };
    } else {
      active = { type: "fixed", dest };
    }
  } else {
    active = sanitizeActiveSurface(rawActive, tabKeys);
    if (active.type === "content" && !tabKeys.has(active.key)) {
      const legacyDest = legacyFixedDestForContentKey(active.key, rawTabs);
      if (legacyDest === "work" && mergedTask) {
        active = { type: "content", key: mergedTask.key };
      } else {
        active = legacyDest ? { type: "fixed", dest: legacyDest } : { type: "home" };
      }
    } else if (active.type === "content" && mergedTask) {
      active = remapActiveContentKey(active.key, rawTabs, mergedTask.key);
    }
  }
  const style = parseStyle(raw.style);
  return { v: 1, tabs, active, style };
}

export function sanitizeTabSession(raw: unknown): TabSession {
  if (!raw || typeof raw !== "object") return emptyTabSession();
  const o = raw as Record<string, unknown>;
  if (o.v === 2) {
    const rawTabs = o.tabs;
    const aliases = legacyColorKeyAliases(rawTabs);
    const panesInput = o.panes as Record<string, unknown> | undefined;
    const leftInput = panesInput?.left as Record<string, unknown> | undefined;
    const rightInput = panesInput?.right as Record<string, unknown> | undefined;
    const focusColorManagement = restoreColorManagementForActiveLegacy(rawTabs, [leftInput?.active, rightInput?.active]);
    const mergedTask = mergeLegacyTaskTab(rawTabs, null);
    const tabs: ContentTabRecord[] = [];
    const seenKeys = new Set<string>();
    const seenIdentities = new Set<string>();
    if (Array.isArray(rawTabs)) {
      for (const item of rawTabs) {
        const tab = sanitizeTabRecord(item);
        if (!tab || seenKeys.has(tab.key)) continue;
        if (tab.identity.kind === "fixed") continue;
        if (isMergedTaskLegacyIdentity(tab.identity)) continue;
        const identityKey = contentTabKey(tab.identity);
        if (seenIdentities.has(identityKey)) continue;
        seenKeys.add(tab.key);
        seenIdentities.add(identityKey);
        tabs.push(tab);
      }
    }
    if (mergedTask && !seenKeys.has(mergedTask.key) && !seenIdentities.has("task-view")) {
      seenKeys.add(mergedTask.key);
      seenIdentities.add("task-view");
      tabs.push(mergedTask);
    }
    if (focusColorManagement) {
      const settings = tabs.find((tab) => tab.identity.kind === "settings");
      if (settings) settings.destState = { tab: "color-management" };
    }
    const tabKeySet = new Set(tabs.map((t) => t.key));
    const panesRaw = panesInput;
    const left = sanitizePaneSnapshot(panesRaw?.left, tabKeySet, "home", aliases);
    let right: PaneSnapshot | undefined;
    if (panesRaw?.right && typeof panesRaw.right === "object") {
      right = sanitizePaneSnapshot(panesRaw.right, tabKeySet, left.tabKeys[0] ?? "home", aliases);
      if (right.tabKeys.length === 0) right = undefined;
    }
    const assigned = new Set([...left.tabKeys, ...(right?.tabKeys ?? [])]);
    for (const tab of tabs) {
      if (!assigned.has(tab.key)) left.tabKeys.push(tab.key);
    }
    const focusedPane = o.focusedPane === "right" && right ? "right" : "left";
    const style = parseStyle(o.style);
    return { v: 2, tabs, panes: { left, ...(right ? { right } : {}) }, focusedPane, style };
  }
  return v1ToV2(sanitizeV1TabSession(o));
}

export function emptyTabSession(): TabSession {
  return {
    v: 2,
    tabs: [],
    panes: { left: { tabKeys: [], active: "home", width: 0 } },
    focusedPane: "left",
    style: "rect",
  };
}

export function hasRestorableSnapshot(session: TabSession): boolean {
  if (session.tabs.length > 0) return true;
  if (session.panes.right) return true;
  if (session.panes.left.tabKeys.length > 0) return true;
  if (session.panes.left.active !== "home") return true;
  return false;
}

export function hasRestorableLayout(): boolean {
  return hasRestorableSnapshot(loadTabSession());
}

export function loadTabSession(): TabSession {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyTabSession();
    return sanitizeTabSession(JSON.parse(raw));
  } catch {
    return emptyTabSession();
  }
}

export function saveTabSession(session: TabSession): void {
  try {
    const payload: TabSession = {
      v: 2,
      tabs: session.tabs,
      panes: session.panes,
      focusedPane: session.focusedPane,
      style: session.style === "trap" ? "trap" : "rect",
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    /* quota */
  }
}

export function clearTabSession(): void {
  const style = loadTabSession().style;
  saveTabSession({ ...emptyTabSession(), style });
}

export function sessionToWorkspacePanes(session: TabSession): WorkspacePanes {
  const left: PaneState = {
    tabKeys: [...session.panes.left.tabKeys],
    active: session.panes.left.active,
    width: session.panes.left.width,
  };
  const right = session.panes.right
    ? {
        tabKeys: [...session.panes.right.tabKeys],
        active: session.panes.right.active,
        width: session.panes.right.width,
      }
    : undefined;
  return { left, ...(right ? { right } : {}) };
}
