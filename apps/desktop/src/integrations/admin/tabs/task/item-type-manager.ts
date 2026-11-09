import { mountFlatSelectPopover, type FlatSelectPopoverHandle } from "../../../../ui/flat-select-popover";
import { createButton } from "../../../../ui/button";
import { mountInlineTextField, type InlineTextFieldHandle } from "../../../../ui/inline-text-field";
import { mountCategoryColorPicker, type CategoryColorPickerHandle } from "../../../../ui/category-color-picker";
import { createInsightDialog } from "../../../../ui/insight-dialog";
import { productivityDeleteItemType, productivityGetItemTypeCatalog, productivitySaveItemTypeCatalog } from "../../../productivity/client";
import type { ItemTypeCatalogSnapshot, ItemTypeSnapshot, SaveItemTypeCatalogRequest } from "../../../productivity/types";
import { setDirtyStatus, waitInFlight } from "../../tab-host/dirty";
import { invokeErrorText, isRevisionConflict } from "../item-compose";
import { getConfirmDialog } from "../../../shell/dialog";
import { isItemTypeHex } from "./item-type-palette";
import { listEffectiveCategorySlots, resolveCategoryRoles, subscribeCategoryAppearance } from "../../../../ui/color-system";
import { ARROW_LEFT_SVG, metaIcon } from "./arrangement-detail";
import "./item-type-manager.css";

type DraftNode = Pick<ItemTypeSnapshot, "id" | "name" | "parentItemTypeId" | "colorOverride" | "inactive" | "systemRole" | "canDelete">;
export type ItemTypeManagerHandle = {
  show: () => void;
  hide: () => void;
  syncCanonical: (catalog: ItemTypeCatalogSnapshot | null) => void;
  adoptSaved: (catalog: ItemTypeCatalogSnapshot | null) => void;
  canDispose: () => Promise<boolean>;
  dispose: () => void;
};

function nodesOf(catalog: ItemTypeCatalogSnapshot | null): DraftNode[] {
  return (catalog?.itemTypes ?? []).map(({ id, name, parentItemTypeId, colorOverride, inactive, systemRole, canDelete }) =>
    ({ id, name, parentItemTypeId, colorOverride, inactive, systemRole, canDelete }));
}

function sameNodes(a: DraftNode[], b: DraftNode[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

const SYSTEM_ROOT_ORDER = ["sleep", "meal", "activity", "travel"];

function systemLabel(node: DraftNode): string {
  return `${node.name.replace(/（系统(?: \d+)?）$/u, "")}（系统内置）`;
}

function confirmDiscard(): Promise<boolean> {
  return new Promise((resolve) => {
    const dialog = createInsightDialog({
      title: "放弃分类更改",
      submitLabel: "放弃更改",
      cancelLabel: "继续编辑",
      bodyHtml: "<p class=\"insight-dialog-hint\">尚有未保存的分类更改。放弃后无法恢复。</p>",
      dangerSubmit: true,
    });
    let settled = false;
    const finish = (result: boolean) => {
      if (settled) return;
      settled = true;
      void dialog.close().then(() => resolve(result));
    };
    dialog.bindChrome(() => finish(false));
    dialog.panel.addEventListener("submit", (event) => { event.preventDefault(); finish(true); });
    void dialog.open();
  });
}

export function mountItemTypeManager(opts: {
  host: HTMLElement;
  initialCatalog: ItemTypeCatalogSnapshot | null;
  expectedDataDir: string;
  onSaved: (catalog: ItemTypeCatalogSnapshot | null) => void;
  onBack: () => void;
}): ItemTypeManagerHandle {
  let canonical = opts.initialCatalog;
  let draft = nodesOf(canonical);
  let loading = false;
  let loadFailed = false;
  let saving = false;
  let disposed = false;
  let shown = false;
  let conflict = false;
  let message = "";
  let loadGeneration = 0;
  let colorPicker: CategoryColorPickerHandle | null = null;
  let colorPickerNode: DraftNode | null = null;
  let nameFields: InlineTextFieldHandle[] = [];
  let pendingFocusId: string | null = null;
  const events = new AbortController();
  let contextMenu: FlatSelectPopoverHandle | null = null;
  let contextMenuAnchor: HTMLElement | null = null;
  const host = opts.host;
  host.classList.add("item-type-manager");

  function surfaceKey(): string | null { return host.closest<HTMLElement>("[data-surface]")?.dataset.surface ?? null; }
  function isDirty(): boolean { return !sameNodes(draft, nodesOf(canonical)); }
  function updateDirty(): void {
    const key = surfaceKey();
    if (key) setDirtyStatus(key, { dirty: isDirty(), inFlight: saving, failed: loadFailed || conflict || Boolean(message && !saving) });
  }
  function setMessage(value: string): void {
    message = value;
    updateDirty();
    render();
  }
  function colorFor(node: DraftNode): string {
    const color = isItemTypeHex(node.colorOverride) ? node.colorOverride
      : node.parentItemTypeId ? effectiveColor(node.parentItemTypeId) ?? "#87909a" : "#87909a";
    return resolveCategoryRoles(color).main;
  }
  function effectiveColor(id: string): string | null {
    const seen = new Set<string>();
    let current = draft.find((node) => node.id === id);
    while (current && !seen.has(current.id)) {
      if (isItemTypeHex(current.colorOverride)) return current.colorOverride;
      seen.add(current.id);
      current = draft.find((node) => node.id === current!.parentItemTypeId);
    }
    return null;
  }
  function children(parentId: string | null): DraftNode[] {
    const nodes = draft.filter((node) => node.parentItemTypeId === parentId);
    if (parentId !== null) return nodes;
    return [...nodes].sort((a, b) => {
      const aRank = SYSTEM_ROOT_ORDER.indexOf(a.systemRole ?? "");
      const bRank = SYSTEM_ROOT_ORDER.indexOf(b.systemRole ?? "");
      const aOrder = aRank === -1 ? SYSTEM_ROOT_ORDER.length : aRank;
      const bOrder = bRank === -1 ? SYSTEM_ROOT_ORDER.length : bRank;
      if (aOrder !== bOrder) return aOrder - bOrder;
      return nodes.indexOf(a) - nodes.indexOf(b);
    });
  }
  function isEffectivelyInactive(node: DraftNode): boolean {
    const seen = new Set<string>();
    let current: DraftNode | undefined = node;
    while (current && !seen.has(current.id)) {
      if (current.inactive) return true;
      seen.add(current.id);
      current = current.parentItemTypeId ? draft.find((candidate) => candidate.id === current!.parentItemTypeId) : undefined;
    }
    return false;
  }
  function nodeRows(parentId: string | null, depth: number, visited: Set<string>): string {
    return children(parentId).map((node) => {
      if (visited.has(node.id)) return "";
      const next = new Set(visited); next.add(node.id);
      const color = colorFor(node);
      const locked = loading || saving || loadFailed;
      const systemLocked = Boolean(node.systemRole);
      const inactive = isEffectivelyInactive(node);
      const nameLabel = systemLocked
        ? `系统分类名称，${systemLabel(node)}`
        : inactive ? `分类名称，${node.inactive ? "已停用" : "随父级停用"}` : "分类名称";
      const nameTitle = systemLocked ? "系统分类不可改名" : inactive ? node.inactive ? "已停用" : "随父级停用" : "";
      const handle = `<span class="item-type-handle" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 8h16"/><path d="M4 12h16"/><path d="M4 16h16"/></svg></span>`;
      const name = systemLocked
        ? `<span class="item-type-name">${escapeHtml(systemLabel(node))}</span>`
        : `<span class="item-type-name" data-name-host aria-label="${escapeAttr(nameLabel)}" title="${escapeAttr(nameTitle)}"></span>`;
      return `<div class="item-type-row${inactive ? " is-inactive" : ""}${systemLocked ? " is-system" : ""}" data-node-id="${node.id}" style="--item-type-depth:${depth}">
        ${handle}${name}
        <button type="button" class="item-type-swatch" data-color-anchor aria-label="为${escapeAttr(node.name || "新分类")}选颜色" style="--item-type-swatch-color:${color}" title="${escapeAttr(color)}"${locked ? " disabled" : ""}></button>
      </div>${nodeRows(node.id, depth + 1, next)}`;
    }).join("");
  }
  function validationError(): string {
    if (loading || loadFailed || !canonical && draft.length === 0) return "";
    if (!opts.expectedDataDir && isDirty()) return "当前数据目录尚未就绪，不能保存分类";
    const names = new Set<string>();
    for (const node of draft) {
      const name = node.name.trim();
      if (!name) return "每个分类都需要名称";
      const key = name.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
      if (names.has(key)) return `分类名称重复：${name}`;
      names.add(key);
      if (node.parentItemTypeId && !draft.some((candidate) => candidate.id === node.parentItemTypeId)) return "分类父级不存在";
      if (!node.parentItemTypeId && !isItemTypeHex(node.colorOverride)) return `顶级分类「${name}」必须选择颜色`;
      if (node.colorOverride !== null && !isItemTypeHex(node.colorOverride)) return `分类「${name}」的颜色无效`;
      let current: DraftNode | undefined = node;
      const seen = new Set<string>();
      while (current) {
        if (seen.has(current.id)) return "分类层级不能形成循环";
        seen.add(current.id);
        current = current.parentItemTypeId ? draft.find((candidate) => candidate.id === current!.parentItemTypeId) : undefined;
      }
    }
    return "";
  }
  function disposeNameFields(): void {
    for (const field of nameFields) field.dispose();
    nameFields = [];
  }
  function paintFooter(): void {
    const error = validationError();
    const alert = host.querySelector<HTMLElement>(".item-type-manager-error");
    const save = host.querySelector<HTMLButtonElement>("[data-save]");
    const discard = host.querySelector<HTMLButtonElement>("[data-discard]");
    if (alert) alert.textContent = conflict ? message : error || message;
    if (save) save.disabled = loading || loadFailed || saving || conflict || !isDirty() || Boolean(error);
    if (discard) discard.hidden = !isDirty() || saving || loading;
  }
  function mountNameFields(): void {
    disposeNameFields();
    host.querySelectorAll<HTMLElement>("[data-name-host]").forEach((container) => {
      const row = container.closest<HTMLElement>("[data-node-id]");
      const node = draft.find((candidate) => candidate.id === row?.dataset.nodeId);
      if (!node) return;
      const locked = loading || saving || loadFailed;
      const systemLocked = Boolean(node.systemRole);
      const field = mountInlineTextField({
        container,
        value: node.name,
        placeholder: "分类名",
        readOnly: locked || systemLocked,
        onCommit: (value) => {
          node.name = value;
          if (!conflict) message = "";
          updateDirty();
          paintFooter();
        },
      });
      nameFields.push(field);
      if (pendingFocusId === node.id) {
        pendingFocusId = null;
        container.querySelector<HTMLButtonElement>(".orbita-inline-text-field__display")?.click();
      }
    });
  }
  function render(): void {
    if (disposed || !shown) return;
    disposeNameFields();
    colorPicker?.dispose();
    colorPicker = null;
    colorPickerNode = null;
    void contextMenu?.close();
    const error = validationError();
    const disabled = loading || loadFailed || saving || conflict || Boolean(error) || !isDirty();
    host.innerHTML = `<div class="item-type-manager-head"><div class="item-type-manager-head-leading"><div class="item-type-manager-head-copy"><h2>分类与标签管理</h2></div></div></div>
      ${loading ? `<p class="item-type-manager-state">正在加载分类…</p>` : loadFailed ? `<div class="item-type-manager-state is-error"><span>${escapeHtml(message || "分类加载失败")}</span><button type="button" data-reload>重新加载</button></div>` : ""}
      <div class="item-type-tree">${nodeRows(null, 0, new Set())}${loading || loadFailed ? "" : `<div class="item-type-row item-type-add-root${saving ? " is-disabled" : ""}" data-add-root role="button" tabindex="0" style="--item-type-depth:0"${saving ? " aria-disabled=\"true\"" : ""}><span class="item-type-handle is-spacer" aria-hidden="true"></span><span class="item-type-name">＋ 新建顶级分类</span></div>`}</div>
      <div class="item-type-manager-footer"><span class="item-type-manager-error" role="alert">${escapeHtml(conflict ? message : error || message)}</span>
        ${conflict ? `<button type="button" data-reload>重新加载最新分类</button>` : ""}
        <button type="button" data-discard${!isDirty() || saving || loading ? " hidden" : ""}>放弃更改</button>
        <button type="button" class="item-type-save" data-save${disabled ? " disabled" : ""}>${saving ? "保存中…" : "保存"}</button></div>`;
    const back = createButton("", { width: 32, height: 32, iconSize: 18 });
    back.classList.add("item-type-manager-back", "task-list-back", "orbita-picker-nav-arrow");
    back.setAttribute("aria-label", "返回");
    back.title = "返回";
    const backIcon = metaIcon(ARROW_LEFT_SVG);
    backIcon.classList.add("item-type-manager-back-icon");
    back.append(backIcon);
    back.addEventListener("click", opts.onBack, { signal: events.signal });
    host.querySelector<HTMLElement>(".item-type-manager-head-leading")?.prepend(back);
    mountNameFields();
    updateDirty();
  }
  function escapeHtml(text: string): string { return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  function escapeAttr(text: string): string { return escapeHtml(text).replace(/"/g, "&quot;"); }
  function addNode(parentItemTypeId: string | null): void {
    if (loading || saving || loadFailed || disposed) return;
    const id = crypto.randomUUID();
    draft = [...draft, { id, name: "", parentItemTypeId, colorOverride: null, inactive: false }];
    if (!conflict) message = "";
    pendingFocusId = id;
    render();
  }
  function openColor(anchor: HTMLElement, node: DraftNode): void {
    if (loading || saving || loadFailed || disposed) return;
    colorPicker?.dispose();
    colorPicker = null;
    const choices = listEffectiveCategorySlots();
    const presetOptions = choices.map((slot) => {
      const roles = resolveCategoryRoles(slot.canonicalHex);
      return { value: slot.canonicalHex, label: roles.name || slot.name, main: roles.main };
    });
    const current = isItemTypeHex(node.colorOverride) ? node.colorOverride : null;
    const canonical = current && choices.find((slot) => slot.canonicalHex.toUpperCase() === current.toUpperCase())?.canonicalHex;
    const selectedValue = current ? canonical ?? current : node.parentItemTypeId ? "" : null;
    const custom = current && !canonical ? (() => {
      const roles = resolveCategoryRoles(current);
      return { value: current, label: "当前自定义色", main: roles.main };
    })() : undefined;
    let handle!: CategoryColorPickerHandle;
    handle = mountCategoryColorPicker({
      anchor,
      options: custom ? [...presetOptions, custom] : presetOptions,
      selected: selectedValue,
      inherit: node.parentItemTypeId ? { value: "", label: "继承父级颜色" } : undefined,
      onOpenChange: (open) => { if (!open && colorPicker === handle) { handle.dispose(); colorPicker = null; } },
      onChange: (chosen) => {
        node.colorOverride = chosen === "" ? null : chosen;
        if (!conflict) message = "";
        render();
      },
    });
    colorPicker = handle;
    colorPickerNode = node;
    void handle.open();
  }
  function refreshAppearance(): void {
    host.querySelectorAll<HTMLElement>("[data-color-anchor]").forEach((anchor) => {
      const id = anchor.closest<HTMLElement>("[data-node-id]")?.dataset.nodeId;
      const node = draft.find((entry) => entry.id === id);
      if (node) { const color = colorFor(node); anchor.style.setProperty("--item-type-swatch-color", color); anchor.title = color; }
    });
    if (colorPicker && colorPickerNode) {
      const choices = listEffectiveCategorySlots();
      colorPicker.setOptions(choices.map((slot) => {
        const roles = resolveCategoryRoles(slot.canonicalHex);
        return { value: slot.canonicalHex, label: roles.name || slot.name, main: roles.main };
      }).concat(isItemTypeHex(colorPickerNode.colorOverride) && !choices.some((slot) => slot.canonicalHex.toUpperCase() === colorPickerNode!.colorOverride!.toUpperCase())
        ? (() => { const roles = resolveCategoryRoles(colorPickerNode!.colorOverride!); return [{ value: colorPickerNode!.colorOverride!, label: "当前自定义色", main: roles.main }]; })()
        : []));
    }
  }
  const unsubscribeAppearance = subscribeCategoryAppearance(refreshAppearance);
  async function loadLatest(confirmDirty: boolean): Promise<void> {
    if (saving || loading) return;
    if (confirmDirty && isDirty() && !(await confirmDiscard())) return;
    const generation = ++loadGeneration;
    loading = true; loadFailed = false; message = ""; conflict = false; render();
    try {
      const response = await productivityGetItemTypeCatalog();
      if (disposed || generation !== loadGeneration) return;
      canonical = response.catalog;
      draft = nodesOf(canonical);
      loading = false; loadFailed = false; message = ""; conflict = false; updateDirty(); render();
      opts.onSaved(canonical);
    } catch (error) {
      if (disposed || generation !== loadGeneration) return;
      loading = false; loadFailed = true; message = `分类加载失败：${invokeErrorText(error)}`; updateDirty(); render();
    }
  }
  async function save(): Promise<void> {
    if (saving || loading || loadFailed || conflict || !isDirty()) return;
    const validation = validationError();
    if (validation) { setMessage(validation); return; }
    if (!opts.expectedDataDir) { setMessage("当前数据目录尚未就绪，不能保存分类"); return; }
    const key = surfaceKey();
    saving = true; message = ""; loadFailed = false; updateDirty(); render();
    const req: SaveItemTypeCatalogRequest = {
      expectedDataDir: opts.expectedDataDir,
      ...(canonical ? { catalog: { id: canonical.id, expectedRevision: canonical.revision } } : {}),
      nodes: draft.map(({ id, name, parentItemTypeId, colorOverride, inactive }) =>
        ({ id, name: name.trim(), parentItemTypeId, colorOverride, inactive })),
    };
    try {
      const response = await productivitySaveItemTypeCatalog(req);
      if (disposed) return;
      canonical = response.catalog;
      draft = nodesOf(canonical);
      conflict = false; message = ""; loadFailed = false; saving = false;
      if (key) setDirtyStatus(key, { dirty: false, inFlight: false, failed: false });
      opts.onSaved(canonical);
      render();
    } catch (error) {
      if (disposed) return;
      saving = false;
      if (key) setDirtyStatus(key, { dirty: true, inFlight: false, failed: true });
      if (isRevisionConflict(error)) {
        conflict = true;
        message = "分类已被其他修改更新";
      } else message = `保存失败：${invokeErrorText(error)}`;
      render();
    }
  }

  host.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    if (target.closest("[data-reload]")) { if (!saving && !loading) void loadLatest(true); return; }
    if (saving || loading || loadFailed || disposed) return;
    const row = target.closest<HTMLElement>("[data-node-id]");
    if (target.closest("[data-add-root]")) { if (!target.closest(".is-disabled")) addNode(null); return; }
    else if (target.closest("[data-color-anchor]") && row) {
      const node = draft.find((candidate) => candidate.id === row.dataset.nodeId);
      const anchor = target.closest<HTMLElement>("[data-color-anchor]");
      if (node && anchor) openColor(anchor, node);
    } else if (target.closest("[data-save]")) void save();
    else if (target.closest("[data-discard]")) void (async () => { if (await confirmDiscard()) { draft = nodesOf(canonical); conflict = false; message = ""; render(); } })();
  }, { signal: events.signal });
  host.addEventListener("contextmenu", (event) => {
    const row = (event.target as HTMLElement).closest<HTMLElement>("[data-node-id]");
    const node = draft.find((candidate) => candidate.id === row?.dataset.nodeId);
    if (!node || !row || saving || loading || loadFailed || disposed) return;
    event.preventDefault();
    contextMenu?.dispose();
    contextMenuAnchor?.remove();
    const anchor = document.createElement("span");
    anchor.style.cssText = `position:fixed;left:${event.clientX}px;top:${event.clientY}px;width:1px;height:1px;opacity:0;pointer-events:none`;
    document.body.appendChild(anchor);
    contextMenuAnchor = anchor;
    contextMenu = mountFlatSelectPopover({
      anchor,
      options: [
        ...(node.systemRole === "travel" || !node.systemRole ? [{ value: "child", label: "新建子分类" }] : []),
        ...(node.systemRole ? [] : [{ value: "inactive", label: node.inactive ? "启用分类" : "停用分类" }]),
        ...(!isDirty() && node.canDelete ? [{ value: "delete", label: "删除", danger: true }] : []),
      ],
      selected: new Set(),
      multiple: false,
      search: false,
      menu: true,
      onOpenChange: (open) => {
        if (!open) {
          row.focus();
          contextMenuAnchor?.remove();
          contextMenuAnchor = null;
          contextMenu = null;
        }
      },
      onChange: (values) => {
        const action = [...values][0];
        if (action === "child") addNode(node.id);
        else if (action === "inactive" && !node.systemRole) { node.inactive = !node.inactive; if (!conflict) message = ""; render(); }
        else if (action === "delete" && canonical && !isDirty() && node.canDelete) {
          void (async () => {
            const ok = await getConfirmDialog()("删除分类", `确定删除「${node.name}」吗？`, row, { danger: true });
            if (!ok || disposed || saving || loading || !canonical) return;
            try {
              const result = await productivityDeleteItemType({
                expectedDataDir: opts.expectedDataDir,
                catalog: { id: canonical.id, expectedRevision: canonical.revision },
                itemTypeId: node.id,
              });
              canonical = result.catalog;
              draft = nodesOf(canonical);
              conflict = false; message = "";
              updateDirty(); render();
            } catch (error) {
              message = `删除失败：${invokeErrorText(error)}`;
              render();
            }
          })();
        }
      },
    });
    void contextMenu.open();
  }, { signal: events.signal });

  function show(): void { shown = true; host.hidden = false; render(); if (!canonical && draft.length === 0) void loadLatest(false); }
  function hide(): void { shown = false; host.hidden = true; void contextMenu?.close(); contextMenu?.dispose(); contextMenu = null; contextMenuAnchor?.remove(); contextMenuAnchor = null; colorPicker?.dispose(); colorPicker = null; colorPickerNode = null; }
  function syncCanonical(next: ItemTypeCatalogSnapshot | null): void {
    if (disposed || saving) return;
    const incomingNodes = nodesOf(next);
    const nodesUnchanged = sameNodes(nodesOf(canonical), incomingNodes);
    if (!nodesUnchanged && isDirty()) return;
    const needsVisualReset = loading || loadFailed || conflict || Boolean(message);
    loadGeneration++; loading = false; canonical = next;
    // Revision-only snapshots keep the current DraftNode objects: an open color picker
    // closes over one of them, and replacing it without repainting would leave it stale.
    if (!nodesUnchanged) draft = incomingNodes;
    loadFailed = false; conflict = false; message = "";
    updateDirty();
    if (!nodesUnchanged || needsVisualReset) render();
  }
  function adoptSaved(next: ItemTypeCatalogSnapshot | null): void {
    if (disposed) return;
    loadGeneration++;
    canonical = next; draft = nodesOf(next); loading = false; loadFailed = false; saving = false; conflict = false; message = "";
    updateDirty(); render();
  }
  function canDispose(): Promise<boolean> {
    return (async () => {
      const key = surfaceKey();
      if (key && saving && !(await waitInFlight(key))) return false;
      if (!isDirty()) return true;
      if (!(await confirmDiscard())) return false;
      draft = nodesOf(canonical); conflict = false; message = ""; updateDirty(); render();
      return true;
    })();
  }
  function dispose(): void {
    disposed = true; loadGeneration++; unsubscribeAppearance(); events.abort(); disposeNameFields(); void contextMenu?.close(); contextMenu?.dispose(); contextMenu = null; contextMenuAnchor?.remove(); contextMenuAnchor = null; colorPicker?.dispose(); colorPicker = null; colorPickerNode = null; host.replaceChildren();
    const key = surfaceKey();
    if (key) setDirtyStatus(key, { dirty: false, inFlight: false, failed: false });
  }
  host.hidden = true;
  return { show, hide, syncCanonical, adoptSaved, canDispose, dispose };
}
