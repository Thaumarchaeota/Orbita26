export type FixedDestId = "timeline" | "work" | "health" | "finance" | "finance1";

export type ContentTabIdentity =
  | { kind: "blank"; id: string }
  | { kind: "health-page"; page: "activities" | "intake" }
  | { kind: "fixed"; dest: FixedDestId }
  | { kind: "project"; id: string }
  | { kind: "project-index" }
  | { kind: "task-view" }
  | { kind: "list"; id: string }
  | { kind: "settings" }
  | { kind: "chat"; id: string }
  | { kind: "meal"; id: string }
  | { kind: "journal"; id: string }
  | { kind: "web"; url: string }
  | { kind: "control-gallery" }
  | { kind: "color-lab" }
  | { kind: "category-palette" };

export type ActiveSurface =
  | { type: "home" }
  | { type: "fixed"; dest: FixedDestId }
  | { type: "content"; key: string };

export type PaneId = "left" | "right";

export type LeftPaneActive = "home" | "timeline" | string;

export type PaneState = {
  tabKeys: string[];
  active: LeftPaneActive | string;
  width: number;
};

export type WorkspacePanes = {
  left: PaneState;
  right?: PaneState;
};

export function fixedSurfaceKey(dest: FixedDestId): string {
  return `fixed:${dest}`;
}

export type ContentTabRecord = {
  key: string;
  identity: ContentTabIdentity;
  title: string;
  destId: "home" | FixedDestId | "health-activities" | "health-intake" | "project" | "project-index" | "work" | "settings" | "chat" | "meal" | "journal" | "web" | "control-gallery" | "color-lab" | "category-palette";
  destState: unknown;
};

function randomId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
}

export function newTabInstanceKey(): string {
  return `tab:${randomId()}`;
}

export function newBlankIdentity(): ContentTabIdentity {
  return { kind: "blank", id: randomId() };
}

export function identitiesEqual(a: ContentTabIdentity, b: ContentTabIdentity): boolean {
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case "blank":
      return b.kind === "blank" && a.id === b.id;
    case "health-page":
      return b.kind === "health-page" && a.page === b.page;
    case "fixed":
      return b.kind === "fixed" && a.dest === b.dest;
    case "project":
      return b.kind === "project" && a.id === b.id;
    case "project-index":
      return b.kind === "project-index";
    case "task-view":
      return b.kind === "task-view";
    case "list":
      return b.kind === "list" && a.id === b.id;
    case "settings":
      return b.kind === "settings";
    case "chat":
      return b.kind === "chat" && a.id === b.id;
    case "meal":
      return b.kind === "meal" && a.id === b.id;
    case "journal":
      return b.kind === "journal" && a.id === b.id;
    case "web":
      return b.kind === "web" && a.url === b.url;
    case "control-gallery":
      return b.kind === "control-gallery";
    case "color-lab":
      return b.kind === "color-lab";
    case "category-palette":
      return b.kind === "category-palette";
  }
}

export function contentTabKey(identity: ContentTabIdentity): string {
  switch (identity.kind) {
    case "blank":
      return `blank:${identity.id}`;
    case "health-page":
      return `health-page:${identity.page}`;
    case "fixed":
      return `fixed:${identity.dest}`;
    case "project":
      return `project:${identity.id}`;
    case "project-index":
      return "project-index";
    case "task-view":
      return "task-view";
    case "list":
      return "task-view";
    case "settings":
      return "settings";
    case "chat":
      return `chat:${identity.id}`;
    case "meal":
      return `meal:${identity.id}`;
    case "journal":
      return `journal:${identity.id}`;
    case "web":
      return `web:${identity.url}`;
    case "control-gallery":
      return "control-gallery";
    case "color-lab":
      return "color-lab";
    case "category-palette":
      return "category-palette";
  }
}

export function destForIdentity(identity: ContentTabIdentity): ContentTabRecord["destId"] {
  switch (identity.kind) {
    case "blank":
      return "home";
    case "health-page":
      return identity.page === "activities" ? "health-activities" : "health-intake";
    case "fixed":
      return identity.dest;
    case "project":
      return "project";
    case "project-index":
      return "project-index";
    case "task-view":
      return "work";
    case "list":
      return "work";
    case "settings":
      return "settings";
    case "chat":
      return "chat";
    case "meal":
      return "meal";
    case "journal":
      return "journal";
    case "web":
      return "web";
    case "control-gallery":
      return "control-gallery";
    case "color-lab":
      return "color-lab";
    case "category-palette":
      return "category-palette";
  }
}

export function destStateForIdentity(identity: ContentTabIdentity): unknown {
  switch (identity.kind) {
    case "blank":
    case "fixed":
    case "health-page":
    case "control-gallery":
    case "color-lab":
    case "category-palette":
      return {};
    case "settings":
      return { tab: "general" };
    case "project":
      return { projectId: identity.id };
    case "project-index":
      return {};
    case "task-view":
      return { view: "week" };
    case "list":
      return { view: "list", filter: identity.id };
    case "chat":
      return { conversationId: identity.id };
    case "meal":
      return {};
    case "journal":
      return { entryId: identity.id };
    case "web":
      return { url: identity.url };
  }
}

export function httpWebIdentity(href: string, base = "https://example.invalid"): ContentTabIdentity | null {
  try {
    const url = new URL(href, base);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return { kind: "web", url: url.href };
  } catch {
    return null;
  }
}

export function defaultTabTitle(identity: ContentTabIdentity): string {
  switch (identity.kind) {
    case "blank":
      return "新标签页";
    case "health-page":
      return identity.page === "activities" ? "所有活动" : "所有摄入";
    case "fixed":
      switch (identity.dest) {
        case "timeline":
          return "时间线";
        case "work":
          return "安排";
        case "health":
          return "健康";
        case "finance":
          return "记账";
        case "finance1":
          return "记账1";
      }
    case "project":
      return "项目";
    case "project-index":
      return "项目";
    case "task-view":
      return "安排";
    case "list":
      return "清单";
    case "settings":
      return "设置";
    case "chat":
      return "新对话";
    case "meal":
      return "新餐食";
    case "journal":
      return "随记";
    case "web":
      try {
        return new URL(identity.url).hostname || "网页";
      } catch {
        return "网页";
      }
    case "control-gallery":
      return "控件";
    case "color-lab":
      return "Color Lab";
    case "category-palette":
      return "分类配色";
  }
}
