import { fitAll, findOpenCardPosition, preferredPositionForSequence, screenToWorld, snapPoint, TASK_CARD_SIZE, TASK_GRID_SIZE, type Camera, type Point, zoomAt } from "./geometry";
import { anchorPoint, cardAnchors, edgeCurve, edgeCurveToPoint, snapCardAnchor } from "./edge-anchors";
import { mountProjectTaskDetail, type ProjectDetailNavigation } from "./task-detail";
import {
  productivityAddTaskSequence,
  productivityCreateTaskInProject,
  productivityDeleteTaskSubtreeMvp,
  productivityGetProject,
  productivityGetBusinessTimeZone,
  productivityListActions,
  productivityListCheckpoints,
  productivityListDeletedTaskBatches,
  productivityMoveTaskSameLevel,
  productivityReorderTaskSiblings,
  productivityRemoveTaskSequence,
  productivitySetTaskSequenceAnchor,
  productivityRestoreTaskSubtreeBatch,
  productivitySetTaskCardPosition,
  productivitySetTaskCardPositions,
  productivitySetTaskStatusGuarded,
  productivityUpdateTask,
  productivityCommitThingLifecycle,
} from "../../../productivity/client";
import type {
  ActionsListResponse,
  BusinessTimeZoneResponse,
  CheckpointsListResponse,
  ProductivityPoint,
  ProjectSnapshot,
  DeletedTaskBatch,
  DeletedTaskBatchesResponse,
  RevisionRef,
  TaskSnapshot,
  TaskSequenceAnchor,
  SetTaskSequenceAnchorRequest,
  AddTaskSequenceRequest,
} from "../../../productivity/types";
import { selectDirectChildProgress } from "./selectors";
import { mountInlineTextField } from "../../../../ui/inline-text-field";
import { createButton } from "../../../../ui/button";
import { hexToOklch, LEGACY_CATEGORY_SLOTS, listEffectiveCategorySlots, resolveCategoryRoles, subscribeCategoryAppearance, type CategoryRoles } from "../../../../ui/color-system";
import { mountSelectField } from "../../../../ui/select-field";
import { showCommandMenuAt, type CommandMenuItem } from "../../../../ui/command-menu-popover";
import { createInsightDialog, type InsightDialogHandle } from "../../../../ui/insight-dialog";
import { mountDecoupledDatePicker } from "../../../../ui/decoupled-date-picker";
import { mountDecoupledDateTimePicker } from "../../../../ui/decoupled-datetime-picker";
import { getConfirmDialog } from "../../../shell/dialog";
import { getSettings } from "../../../../core/settings";
import { instantForWall, dateAt, minuteAt } from "../task/arrangement-model";
import { setDirtyStatus } from "../../tab-host/dirty";
import type { InsightHostContext, InsightDestination, InsightDestinationHandle } from "../../types";
import type { ProjectRailBinding } from "../project-rail";
import { createProjectRail } from "../project-rail";
import type { ProjectTaskFocusPageRequest } from "../../tab-host/host-api";
import "./project-page.css";
import "../task/task.css";

const PROJECT_TASK_CARD_SIZE = Object.freeze({ ...TASK_CARD_SIZE, height: 80 });

export type ProjectPageRegions = {
  root: HTMLElement;
  title: HTMLElement;
  error: HTMLElement;
  loading: HTMLElement;
  firstLayer: HTMLElement;
  firstTaskList: HTMLElement;
  firstCreateForm: HTMLFormElement;
  firstCreateInput: HTMLInputElement;
  mapLayer: HTMLElement;
  mapViewport: HTMLElement;
  mapCanvas: HTMLElement;
  mapEdges: SVGSVGElement;
  mapCards: HTMLElement;
  mapControls: SVGSVGElement;
  taskSidebar: HTMLElement;
  breadcrumb: HTMLElement;
  detailLayer: HTMLElement;
  detailHeading: HTMLElement;
  detailParentSelect: HTMLElement;
  detailTaskList: HTMLElement;
  detailCreateForm: HTMLFormElement;
  detailCreateInput: HTMLInputElement;
  detailClose: HTMLButtonElement;
  mapEmpty: HTMLElement;
  mapZoom: HTMLOutputElement;
};

const PAGE_HTML = `
  <main class="project-page-v2" aria-label="项目任务">
    <div hidden><h1 data-project-region="title"></h1></div>
    <p class="project-page-v2__message" data-project-region="error" role="alert" hidden></p>
    <p class="project-page-v2__loading" data-project-region="loading" aria-live="polite">正在读取项目…</p>
    <aside class="project-page-v2__layer project-page-v2__first" data-project-region="first" aria-label="第一层任务选择" hidden>
      <div class="project-page-v2__section-head">
        <h2>一级任务</h2>
        <div class="project-rail-task-actions"><button type="button" class="insight-chat-rail-new project-rail-entry" data-project-rail-icon data-first-create-toggle aria-label="添加一级任务" title="添加一级任务" aria-expanded="false">+</button><button type="button" class="insight-chat-rail-new project-rail-entry" data-project-rail-icon data-project-action="deleted" aria-label="已删除任务" title="已删除任务">⋯</button></div>
      </div>
        <form class="project-page-v2__create" data-project-region="first-create" hidden>
          <input data-project-region="first-input" placeholder="添加任务" autocomplete="off" maxlength="240">
          <button type="submit" data-project-compact>添加</button>
        </form>
      <div class="project-page-v2__task-list" data-project-region="first-list"></div>
    </aside>
    <section class="project-page-v2__layer project-page-v2__map" data-project-region="map" aria-label="第二层路径图" hidden>
      <nav class="project-page-v2__path-capsule" data-project-region="breadcrumb" aria-label="当前位置"></nav>
      <div class="project-page-v2__map-viewport" data-project-region="map-viewport" tabindex="0" aria-label="任务路径图。方向键可移动选中卡片。">
        <div class="project-page-v2__map-canvas" data-project-region="map-canvas">
          <svg class="project-page-v2__edges" data-project-region="map-edges" aria-hidden="true"></svg>
          <div class="project-page-v2__cards" data-project-region="map-cards"><div class="project-page-v2__map-scrim" data-map-scrim aria-hidden="true"></div></div>
          <svg class="project-page-v2__edge-controls" data-project-region="map-controls" aria-label="顺序线端点"></svg>
          <div class="project-page-v2__marquee" data-project-marquee hidden></div>
          <p class="project-page-v2__empty-map" data-project-region="map-empty">选择一项第一层任务以查看路径图</p>
        </div>
      </div>
      <div class="project-page-v2__zoom" role="group" aria-label="路径图缩放"><button type="button" data-project-zoom="out" aria-label="缩小路径图" title="缩小">−</button><output data-project-region="map-zoom" aria-label="路径图缩放比例">100%</output><button type="button" data-project-zoom="in" aria-label="放大路径图" title="放大">+</button></div>
    </section>
    <div class="insight-task-page project-page-v2__right-rail"><aside class="arrangement-detail-rail" data-project-region="task-sidebar" aria-label="任务详情与安排"></aside></div>
    <section class="project-page-v2__layer project-page-v2__detail" data-project-region="detail" aria-label="第三层任务" hidden>
      <div class="project-page-v2__detail-head">
        <div><p class="project-page-v2__eyebrow">第三层 · 平铺列表</p><h2 data-project-region="detail-heading"></h2></div>
        <div class="project-page-v2__parent-switch"><span>查看同层任务</span><div data-project-region="detail-parent"></div></div>
        <button type="button" data-project-action="close-detail" aria-label="关闭第三层">关闭</button>
      </div>
      <form class="project-page-v2__create" data-project-region="detail-create">
        <input data-project-region="detail-input" placeholder="添加第三层任务" autocomplete="off" maxlength="240">
        <button type="submit">添加</button>
      </form>
      <div class="project-page-v2__task-list project-page-v2__task-list--flat" data-project-region="detail-list"></div>
    </section>
  </main>`;

function required<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Project page region missing: ${selector}`);
  return element;
}

function mountProjectButtons(host: ParentNode): void {
  host.querySelectorAll<HTMLButtonElement>("button:not([data-project-zoom]):not([data-project-rail-icon])").forEach((source) => {
    const label = source.textContent ?? "";
    const button = createButton(label, { width: source.hasAttribute("data-project-compact") ? 64 : label.length > 8 ? 180 : 100, height: 34 });
    for (const attribute of Array.from(source.attributes)) {
      if (attribute.name === "class") button.classList.add(...attribute.value.split(/\s+/).filter(Boolean));
      else button.setAttribute(attribute.name, attribute.value);
    }
    source.replaceWith(button);
  });
}

/** Creates only private page structure; domain state and writes remain in the destination controller. */
export function mountProjectPage(root: HTMLElement): ProjectPageRegions {
  root.innerHTML = PAGE_HTML;
  mountProjectButtons(root);
  return {
    root: required(root, ".project-page-v2"),
    title: required(root, '[data-project-region="title"]'),
    error: required(root, '[data-project-region="error"]'),
    loading: required(root, '[data-project-region="loading"]'),
    firstLayer: required(root, '[data-project-region="first"]'),
    firstTaskList: required(root, '[data-project-region="first-list"]'),
    firstCreateForm: required(root, '[data-project-region="first-create"]'),
    firstCreateInput: required(root, '[data-project-region="first-input"]'),
    mapLayer: required(root, '[data-project-region="map"]'),
    mapViewport: required(root, '[data-project-region="map-viewport"]'),
    mapCanvas: required(root, '[data-project-region="map-canvas"]'),
    mapEdges: required(root, '[data-project-region="map-edges"]'),
    mapCards: required(root, '[data-project-region="map-cards"]'),
    mapControls: required(root, '[data-project-region="map-controls"]'),
    taskSidebar: required(root, '[data-project-region="task-sidebar"]'),
    breadcrumb: required(root, '[data-project-region="breadcrumb"]'),
    detailLayer: required(root, '[data-project-region="detail"]'),
    detailHeading: required(root, '[data-project-region="detail-heading"]'),
    detailParentSelect: required(root, '[data-project-region="detail-parent"]'),
    detailTaskList: required(root, '[data-project-region="detail-list"]'),
    detailCreateForm: required(root, '[data-project-region="detail-create"]'),
    detailCreateInput: required(root, '[data-project-region="detail-input"]'),
    detailClose: required(root, '[data-project-action="close-detail"]'),
    mapEmpty: required(root, '[data-project-region="map-empty"]'),
    mapZoom: required(root, '[data-project-region="map-zoom"]'),
  };
}

export function setProjectPageLoading(regions: ProjectPageRegions, loading: boolean): void {
  regions.loading.hidden = !loading;
  regions.firstLayer.hidden = loading;
  regions.mapLayer.hidden = loading;
}

export function setProjectPageError(regions: ProjectPageRegions, message: string): void {
  regions.error.hidden = !message;
  regions.error.textContent = message;
}

export function setProjectPageProject(regions: ProjectPageRegions, project: ProjectSnapshot): void {
  regions.title.textContent = project.title;
  regions.loading.hidden = true;
  regions.firstLayer.hidden = false;
  regions.mapLayer.hidden = false;
}

export function liveTaskChildren(project: ProjectSnapshot, parentTaskId: string | null): TaskSnapshot[] {
  return project.tasks
    .filter((task) => !task.deletedAtUtc && (task.parentTaskId ?? null) === parentTaskId)
    .slice()
    .sort((a, b) => (a.siblingPosition ?? 0) - (b.siblingPosition ?? 0));
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export function renderProjectTaskRows(
  host: HTMLElement,
  tasks: readonly TaskSnapshot[],
  selectedTaskId: string | null = null,
): void {
  host.replaceChildren();
  for (const task of tasks) {
    const row = document.createElement("article");
    row.className = "project-page-v2__task-row";
    row.dataset.taskId = task.id;
    row.dataset.selected = String(task.id === selectedTaskId);
    row.innerHTML = `<div class="project-page-v2__task-title" data-project-title="${escapeHtml(task.id)}"></div>
      <div class="project-page-v2__task-progress" data-project-progress="${escapeHtml(task.id)}"></div>
      <div class="project-page-v2__task-controls" data-project-controls="${escapeHtml(task.id)}"></div>`;
    host.append(row);
  }
}

export type ProjectMapNode = { task: TaskSnapshot; position: Point; progress?: string };
export type ProjectMapEdge = { id: string; sourceTaskId: string; targetTaskId: string; sourceAnchor?: TaskSequenceAnchor | null; targetAnchor?: TaskSequenceAnchor | null };

function taskStatusGlowRoles(): Map<string, CategoryRoles> {
  const slots = listEffectiveCategorySlots().map((slot) => ({ slot, color: hexToOklch(slot.main) }));
  const result = new Map<string, CategoryRoles>();
  const neutral = slots.filter(({ color }) => color.c < 0.025).sort((a, b) => a.color.c - b.color.c)[0];
  if (neutral) result.set("未做", resolveCategoryRoles(neutral.slot.canonicalHex));
  // Temporary status-to-category mapping uses displayed hues: palette slot IDs are stable across schemes.
  for (const [status, categoryId] of [["进行中", "category-blue"], ["完成", "category-green"], ["搁置", "category-gold"], ["取消", "category-red"]] as const) {
    const anchor = LEGACY_CATEGORY_SLOTS.find((slot) => slot.id === categoryId)!;
    const hue = hexToOklch(anchor.canonicalHex).h;
    const distance = (candidate: (typeof slots)[number]) => { const delta = Math.abs(candidate.color.h - hue); return Math.min(delta, 360 - delta); };
    const candidate = slots.filter(({ color }) => color.c >= 0.025).sort((a, b) => distance(a) - distance(b))[0];
    if (candidate) result.set(status, resolveCategoryRoles(candidate.slot.canonicalHex));
  }
  return result;
}

export function mapDragCaptureTarget(regions: ProjectPageRegions): HTMLElement { return regions.mapViewport; }
export function projectMapProgressLabel(taskId: string, tasks: readonly TaskSnapshot[]): string {
  const progress = selectDirectChildProgress(taskId, tasks);
  return `${progress.completed}/${progress.total} 已完成`;
}
export function deletedBatchRestoreEdgeIds(edgeIds: readonly string[]): string[] { return [...edgeIds]; }
export function deletedBatchRestoreRequest(expectedDataDir: string, response: DeletedTaskBatchesResponse, batch: DeletedTaskBatch) {
  return {
    expectedDataDir,
    project: { id: response.projectId, expectedRevision: response.projectRevision },
    taskId: batch.rootTaskId,
    expectedDeletionBatchId: batch.deletionBatchId,
    expectedSubtreeTaskIds: [...batch.taskIds],
    expectedEdgeIds: deletedBatchRestoreEdgeIds(batch.edgeIds),
  };
}

export function renderProjectMap(
  regions: ProjectPageRegions,
  nodes: readonly ProjectMapNode[],
  edges: readonly ProjectMapEdge[],
  camera: Camera,
  selectedTaskId: string | null,
): void {
  const visibleIds = new Set(nodes.map((node) => node.task.id));
  for (const card of regions.mapCards.querySelectorAll<HTMLElement>("[data-task-id]")) {
    if (!visibleIds.has(card.dataset.taskId ?? "")) card.remove();
  }
  regions.mapEdges.replaceChildren();
  regions.mapEmpty.hidden = nodes.length > 0;
  regions.mapCanvas.style.transform = `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})`;
  regions.mapZoom.value = `${Math.round(camera.zoom * 100)}%`;
  required<HTMLButtonElement>(regions.mapLayer, '[data-project-zoom="out"]').disabled = regions.mapLayer.dataset.taskFocused === "true" || camera.zoom <= 0.25;
  required<HTMLButtonElement>(regions.mapLayer, '[data-project-zoom="in"]').disabled = regions.mapLayer.dataset.taskFocused === "true" || camera.zoom >= 2.5;
  const glowRoles = taskStatusGlowRoles();
  for (const node of nodes) {
    let card = [...regions.mapCards.children].find((element) => (element as HTMLElement).dataset.taskId === node.task.id) as HTMLElement | undefined;
    if (!card) {
      card = document.createElement("article");
      card.tabIndex = 0;
      card.setAttribute("role", "button");
      card.innerHTML = `<div class="project-page-v2__map-card-face"><div class="project-page-v2__map-card-title" data-card-title></div><span class="project-page-v2__map-card-progress"></span></div><div class="project-page-v2__card-expansion" inert><div class="project-page-v2__card-expansion-clip"><div class="project-page-v2__child-list" data-card-children></div></div></div>`;
      regions.mapCards.append(card);
    }
    card.className = "project-page-v2__map-card";
    card.dataset.taskId = node.task.id;
    const glow = glowRoles.get(node.task.status);
    card.dataset.statusGlow = String(Boolean(glow));
    card.style.setProperty("--project-task-selection-color", glow?.unfinishedTitle ?? "var(--insight-text-secondary)");
    if (glow) {
      card.style.setProperty("--project-task-glow-near", `color-mix(in srgb, ${glow.glowPrimary} ${glow.glowPrimaryOpacity * 60}%, transparent)`);
      card.style.setProperty("--project-task-glow-far", `color-mix(in srgb, ${glow.glowSecondary} ${glow.glowSecondaryOpacity * 50}%, transparent)`);
      card.style.setProperty("--project-task-glow-border", `color-mix(in srgb, ${glow.main} 28%, var(--insight-border-color))`);
    }
    card.setAttribute("aria-pressed", String(node.task.id === selectedTaskId));
    card.style.left = `${node.position.x}px`;
    card.style.top = `${node.position.y}px`;
    card.style.width = `${PROJECT_TASK_CARD_SIZE.width}px`;
    if (!card.style.height) card.style.height = `${PROJECT_TASK_CARD_SIZE.height}px`;
    const title = required<HTMLElement>(card, "[data-card-title]");
    if (!title.hasAttribute("data-inline-mounted")) title.textContent = node.task.title;
    required<HTMLElement>(card, ".project-page-v2__map-card-progress").textContent = node.progress ?? "0/0 已完成";
  }

  const nodeById = new Map(nodes.map((node) => [node.task.id, node]));
  const svg = regions.mapEdges;
  const svgNS = "http://www.w3.org/2000/svg";
  const bounds = nodes.map(({ position }) => ({ x: position.x, y: position.y, ...PROJECT_TASK_CARD_SIZE }));
  const left = Math.min(0, ...bounds.map((b) => b.x - 40));
  const top = Math.min(0, ...bounds.map((b) => b.y - 40));
  const right = Math.max(regions.mapViewport.clientWidth, ...bounds.map((b) => b.x + b.width + 40));
  const bottom = Math.max(regions.mapViewport.clientHeight, ...bounds.map((b) => b.y + b.height + 40));
  svg.setAttribute("viewBox", `${left} ${top} ${Math.max(1, right - left)} ${Math.max(1, bottom - top)}`);
  svg.style.left = `${left}px`;
  svg.style.top = `${top}px`;
  svg.style.right = "auto";
  svg.style.bottom = "auto";
  svg.style.width = `${right - left}px`;
  svg.style.height = `${bottom - top}px`;
  for (const edge of edges) {
    const source = nodeById.get(edge.sourceTaskId);
    const target = nodeById.get(edge.targetTaskId);
    if (!source || !target) continue;
    const curve = edgeCurve(
      { ...source.position, ...PROJECT_TASK_CARD_SIZE },
      { ...target.position, ...PROJECT_TASK_CARD_SIZE },
      edge.sourceAnchor, edge.targetAnchor,
    );
    const path = document.createElementNS(svgNS, "path");
    path.setAttribute("d", `M ${curve.start.x} ${curve.start.y} C ${curve.control1.x} ${curve.control1.y}, ${curve.control2.x} ${curve.control2.y}, ${curve.end.x} ${curve.end.y}`);
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", "currentColor");
    path.setAttribute("stroke-width", "2");
    path.dataset.edgeId = edge.id;
    path.dataset.sourceTaskId = edge.sourceTaskId;
    path.dataset.targetTaskId = edge.targetTaskId;
    path.classList.add("project-page-v2__edge");
    path.style.pointerEvents = "none";
    // Invisible wide hit target lets the controller attach the standard context menu to a relation.
    const hit = document.createElementNS(svgNS, "path");
    hit.setAttribute("d", path.getAttribute("d") ?? "");
    hit.setAttribute("fill", "none");
    hit.setAttribute("stroke", "transparent");
    hit.setAttribute("stroke-width", "14");
    hit.dataset.edgeId = edge.id;
    hit.dataset.sourceTaskId = edge.sourceTaskId;
    hit.dataset.targetTaskId = edge.targetTaskId;
    hit.classList.add("project-page-v2__edge-hit");
    hit.style.pointerEvents = "stroke";
    svg.append(path, hit);
  }
}

/** Updates a drag preview in place so pointer capture and card identity survive each frame. */
export function updateProjectMapPositionInPlace(regions: ProjectPageRegions, nodes: readonly ProjectMapNode[], taskId: string, position: Point, edges: readonly ProjectMapEdge[] = []): boolean {
  const card = [...regions.mapCards.querySelectorAll<HTMLElement>("[data-task-id]")].find((candidate) => candidate.dataset.taskId === taskId);
  if (!card) return false;
  card.style.left = `${position.x}px`;
  card.style.top = `${position.y}px`;
  const positions = new Map(nodes.map((node) => [node.task.id, node.position]));
  positions.set(taskId, position);
  for (const path of regions.mapEdges.querySelectorAll<SVGPathElement>("[data-source-task-id][data-target-task-id]")) {
    const source = positions.get(path.dataset.sourceTaskId ?? "");
    const target = positions.get(path.dataset.targetTaskId ?? "");
    if (!source || !target) continue;
    const edge = edges.find((candidate) => candidate.id === path.dataset.edgeId);
    const curve = edgeCurve({ ...source, ...PROJECT_TASK_CARD_SIZE }, { ...target, ...PROJECT_TASK_CARD_SIZE }, edge?.sourceAnchor, edge?.targetAnchor);
    path.setAttribute("d", `M ${curve.start.x} ${curve.start.y} C ${curve.control1.x} ${curve.control1.y}, ${curve.control2.x} ${curve.control2.y}, ${curve.end.x} ${curve.end.y}`);
  }
  return true;
}

export function mapScreenPoint(regions: ProjectPageRegions, camera: Camera, clientX: number, clientY: number): Point {
  const rect = regions.mapViewport.getBoundingClientRect();
  return screenToWorld({ x: clientX - rect.left, y: clientY - rect.top }, camera);
}

const TASK_STATUSES = ["未做", "进行中", "完成", "搁置", "取消"];
const SELECT_OPTIONS = TASK_STATUSES.map((status) => ({ value: status, label: status }));

type PointDraft = ProductivityPoint | null;
type TaskDetailDraft = { taskId: string; title: string; description: string; plannedPoint: PointDraft; duePoint: PointDraft };
export type MapDragIntent = {
  projectId: string;
  generation: number;
  expectedDataDir: string;
  projectRevision: number;
  taskId: string;
  parentTaskId: string | null;
  originalPosition: Point;
};
export function consumeMapDragCommit(drag: { moved: boolean; committed: boolean }): boolean {
  if (!drag.moved || drag.committed) return false;
  drag.committed = true;
  return true;
}

export type MapDragCurrent = {
  projectId: string | null;
  generation: number;
  expectedDataDir: string;
  dataDirKey: string;
  currentDataDir: string;
  project: ProjectSnapshot | null;
};

export function isMapDragIntentCurrent(intent: MapDragIntent, current: MapDragCurrent): boolean {
  if (intent.projectId !== current.projectId || intent.generation !== current.generation) return false;
  if (intent.expectedDataDir !== current.expectedDataDir) return false;
  if ((current.currentDataDir || "_default") !== current.dataDirKey) return false;
  const snapshot = current.project;
  if (!snapshot || snapshot.id !== intent.projectId || snapshot.revision !== intent.projectRevision) return false;
  const task = snapshot.tasks.find((candidate) => candidate.id === intent.taskId);
  return Boolean(task && !task.deletedAtUtc && (task.parentTaskId ?? null) === intent.parentTaskId);
}

type MapDrag = MapDragIntent & { pointerId: number; startX: number; startY: number; offset: Point; moved: boolean; committed: boolean; alt: boolean; members: Array<{ task: TaskSnapshot; position: Point }> };

function ref(snapshot: { id: string; revision: number }): RevisionRef {
  return { id: snapshot.id, expectedRevision: snapshot.revision };
}

function errorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  if (raw.includes("PROJECT_POSITION_INTENT_STALE")) return "项目、父任务或版本在拖动期间发生变化；旧位置没有写入，请核对保留的位置草稿。";
  if (raw.includes("TASK_RESTORE_PARENT_DELETED")) return "无法恢复：父任务仍处于删除状态。请先恢复父任务，再重试此批次。";
  if (raw.includes("TASK_SEQUENCE_CYCLE")) return "此顺序关系会形成循环，请调整连接方向。";
  if (raw.includes("TASK_SEQUENCE_DUPLICATE")) return "这两项任务之间已经存在顺序关系。";
  if (raw.includes("TASK_MOVE_HAS_SEQUENCE_EDGES")) return "此任务仍参与顺序关系，解除相关连接后再移动。";
  if (raw.includes("TASK_PENDING_CHECKPOINT_BLOCKS_STATUS")) return "此任务还有待完成检查点，请先处理后再更改状态。";
  if (raw.includes("ACTIVE_ACTION_BLOCKS_THING")) return "此任务或后代有已开始的安排，不能普通完成或取消。";
  return raw;
}

function isRevisionConflict(error: unknown): boolean {
  const message = errorMessage(error);
  return message.includes("REVISION_CONFLICT") || message.includes("版本已变化") || message.includes("revision");
}

function descendantsOf(project: ProjectSnapshot, taskId: string): TaskSnapshot[] {
  const children = new Map<string, TaskSnapshot[]>();
  for (const task of project.tasks) {
    const parentId = task.parentTaskId ?? "";
    const group = children.get(parentId) ?? [];
    group.push(task);
    children.set(parentId, group);
  }
  const out: TaskSnapshot[] = [];
  const visit = (parentId: string): void => {
    for (const child of children.get(parentId) ?? []) {
      if (child.deletedAtUtc) continue;
      out.push(child);
      visit(child.id);
    }
  };
  visit(taskId);
  return out;
}

function pointDateTime(point: ProductivityPoint | null | undefined, zone: BusinessTimeZoneResponse): { date: string; time: string } {
  if (!point) return { date: "", time: "" };
  if (point.precision === "date") return { date: point.date, time: "" };
  const instant = Date.parse(point.atUtc);
  const minute = minuteAt(instant, zone);
  return { date: dateAt(instant, zone), time: `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}` };
}

export type ProjectDestinationOptions = {
  root: HTMLElement;
  context: InsightHostContext;
  rail: ProjectRailBinding;
};

export function isCurrentProjectFocusRequest(request: ProjectTaskFocusPageRequest | null, projectId: string | null, generation: number): request is ProjectTaskFocusPageRequest {
  return Boolean(request && request.kind === "focus-project-task" && request.projectId === projectId && request.generation === generation);
}

export const projectPageDestination: InsightDestination = {
  id: "project",
  kind: "workspace",
  label: "项目",
  icon: "work",
  showInNav: false,
  mount(root, context) {
    return mountProjectDestination({ root, context, rail: createProjectRail(context) });
  },
};

/** Project/Task page controller. The Project snapshot is the sole mutable domain source. */
export function mountProjectDestination(options: ProjectDestinationOptions): InsightDestinationHandle {
  const { root, context, rail } = options;
  const page = mountProjectPage(root);
  page.firstLayer.remove();
  const generation = context.generation;
  const expectedDataDir = context.dataDirKey === "_default" ? getSettings().dataDir.trim() : context.dataDirKey;
  const surfaceKey = root.dataset.surface ?? "project";
  let projectId: string | null = null;
  let project: ProjectSnapshot | null = null;
  let deleted = false;
  let disposed = false;
  let selectedRootTaskId: string | null = null;
  let selectedMapTaskId: string | null = null;
  const selectedMapTaskIds = new Set<string>();
  let marquee: { pointerId: number; startX: number; startY: number; start: Point; current: Point; camera: Camera; moved: boolean; projectId: string; parentTaskId: string; initialSelection: Set<string>; additive: boolean } | null = null;
  const expandedTaskIds = new Set<string>();
  const cardTitles = new Map<string, { host: HTMLElement; field: ReturnType<typeof mountInlineTextField> }>();
  const failedTitles = new Map<string, string>();
  let taskSidebar: ReturnType<typeof mountProjectTaskDetail> | null = null;
  let detailParentId: string | null = null;
  let detailFocusTaskId: string | null = null;
  let detailDialog: InsightDialogHandle | null = null;
  let renderOpenDetailRows: (() => void) | null = null;
  let detailDraft: TaskDetailDraft | null = null;
  let detailDirty = false;
  let detailFailed = false;
  let detailSaving = false;
  let selectedEdgeId: string | null = null;
  let anchorDrag: { request: SetTaskSequenceAnchorRequest; pointerId: number; candidate: TaskSequenceAnchor | null } | null = null;
  let anchorDraft: { request: SetTaskSequenceAnchorRequest; failed: boolean; error?: string } | null = null;
  let anchorSaving = false;
  type LinkPin = { taskId: string; anchor: TaskSequenceAnchor };
  type LinkIntent = { request: AddTaskSequenceRequest; parentTaskId: string };
  let hoverPin: LinkPin | null = null;
  let hoverReady = false;
  let hoverPoint: Point | null = null;
  let linkDrag: { intent: LinkIntent; pointerId: number; startX: number; startY: number; point: Point; target: LinkPin | null } | null = null;
  let linkDraft: LinkIntent | null = null;
  let linkSaving = false;
  let linkError = "";
  const linkOverlay = document.createElementNS("http://www.w3.org/2000/svg", "g");
  const hoverOverlay = document.createElementNS("http://www.w3.org/2000/svg", "g");
  const hoverDots = new Map<string, { taskId: string; group: SVGGElement; hit: SVGCircleElement; dot: SVGCircleElement; removal: number | null }>();
  let edgeContextMenu: ReturnType<typeof showCommandMenuAt> | null = null;
  let focusEpoch = 0;
  let camera: Camera = { x: 0, y: 0, zoom: 1 };
  let drag: MapDrag | null = null;
  let pan: { pointerId: number; x: number; y: number; camera: Camera } | null = null;
  let spaceDown = false;
  let suppressMapClick = false;
  let suppressLinkClick = false;
  let frame: number | null = null;
  let dragFrame: number | null = null;
  let anchorFrame: number | null = null;
  let writeCount = 0;
  let writeQueue: Promise<unknown> = Promise.resolve();
  let pendingFocus: ProjectTaskFocusPageRequest | null = null;
  const previewPositions = new Map<string, Point>();
  const failedPositions = new Map<string, Point>();
  let rowControls: Array<{ dispose: () => void }> = [];
  let detailControls: Array<{ dispose: () => void }> = [];
  let detailRowControls: Array<{ dispose: () => void }> = [];
  let detailPickers: Array<{ dispose: () => void }> = [];
  let detailParentSelect: ReturnType<typeof mountSelectField> | null = null;
  let applyingNavigation = false;
  let canonicalReadError: unknown = null;
  type ProjectNavigationRoute = { projectId: string | null; rootTaskId: string | null; mapTaskId: string | null; expandedTaskIds: string[];
    detailTaskId: string | null; detailFocusTaskId: string | null; sidebar: ProjectDetailNavigation };

  function captureProjectNavigation() {
    return { route: { projectId, rootTaskId: selectedRootTaskId, mapTaskId: selectedMapTaskId, expandedTaskIds: [...expandedTaskIds].sort(),
      detailTaskId: detailDialog ? detailParentId : null, detailFocusTaskId, sidebar: taskSidebar?.captureNavigation() ?? { taskId: null, selection: null, focusActionId: null } } satisfies ProjectNavigationRoute,
      context: { camera: { ...camera }, firstTop: page.firstTaskList.scrollTop, detailTop: detailDialog?.panel.scrollTop ?? 0, sidebarTop: page.taskSidebar.scrollTop } };
  }
  function requestProjectNavigation(patch: Partial<ProjectNavigationRoute>, returnToPrevious = false): boolean {
    if (applyingNavigation || !context.navigation) return false;
    const state = captureProjectNavigation();
    void context.navigation.navigate({ ...state, route: { ...state.route, ...patch } }, { returnToPrevious });
    return true;
  }
  function navigationDraftBlocked(): boolean {
    return Boolean(detailDirty || detailFailed || detailSaving || writeCount || failedPositions.size || previewPositions.size || anchorDrag || anchorDraft || anchorSaving || linkDrag || linkDraft || linkSaving || failedTitles.size || taskSidebar?.isDirty() || page.firstCreateInput.value.trim() || page.mapCards.querySelector("input, textarea"));
  }

  const live = (): boolean => {
    if (disposed || context.generation !== generation) return false;
    const currentDir = getSettings().dataDir.trim();
    return (currentDir || "_default") === context.dataDirKey && (expectedDataDir.length > 0 || currentDir.length === 0);
  };

  function syncDirty(): void {
    if (disposed) return;
    setDirtyStatus(surfaceKey, {
      dirty: Boolean(detailDirty || previewPositions.size || failedPositions.size || anchorDrag || anchorDraft || linkDrag || linkDraft || failedTitles.size || taskSidebar?.isDirty() || page.firstCreateInput.value.trim() || page.mapCards.querySelector("input, textarea")),
      inFlight: writeCount > 0 || detailSaving || anchorSaving || linkSaving,
      failed: detailFailed || failedPositions.size > 0 || Boolean(anchorDraft?.failed) || Boolean(linkDraft && !linkSaving),
    });
  }

  function setError(message: string): void {
    if (!message && linkDraft && !linkSaving) { showLinkFailure(); return; }
    if (!message && anchorDraft?.failed) { showAnchorFailure(); return; }
    setProjectPageError(page, message);
  }

  function setPositionDraftError(message: string, taskId: string, position: Point): void {
    setError(`${message} 任务 ${taskId} 的位置草稿保留为 (${position.x}, ${position.y})。`);
    const discard = createButton("放弃未保存的位置并重新读取", { width: 240, height: 34 });
    discard.type = "button";
    discard.classList.add("project-page-v2__discard-position-draft");
    discard.textContent = "放弃未保存的位置并重新读取";
    discard.addEventListener("click", () => {
      void (async () => {
        const confirmed = await getConfirmDialog()("放弃位置草稿并刷新", `将放弃 ${failedPositions.size} 个未保存的卡片位置，重新读取最新项目。任务详情草稿不会被清除。`, undefined, { confirmLabel: "放弃位置并刷新", danger: true });
        if (!confirmed || !live()) return;
        failedPositions.clear();
        previewPositions.clear();
        syncDirty();
        await refreshCanonical(true);
      })();
    });
    page.error.append(document.createTextNode(" "), discard);
    syncDirty();
  }

  function dragIsCurrent(intent: MapDragIntent, snapshot = project): boolean {
    return isMapDragIntentCurrent(intent, {
      projectId,
      generation: context.generation,
      expectedDataDir,
      dataDirKey: context.dataDirKey,
      currentDataDir: getSettings().dataDir.trim(),
      project: snapshot,
    });
  }

  function applyCanonical(next: ProjectSnapshot, render = true): void {
    if (!live() || next.id !== projectId) return;
    // A late read or write response must not revive a project deleted in another surface.
    if (deleted && !next.deletedAtUtc) return;
    clearHoverPin(true);
    project = next;
    if (linkDrag && !linkIsCurrent(linkDrag.intent, false)) cancelLinkDrag();
    deleted = Boolean(next.deletedAtUtc);
    for (const id of failedTitles.keys()) {
      if (deleted || !next.tasks.some((task) => task.id === id && !task.deletedAtUtc)) failedTitles.delete(id);
    }
    for (const drafts of [failedPositions, previewPositions]) for (const id of drafts.keys()) {
      if (deleted || !next.tasks.some((task) => task.id === id && !task.deletedAtUtc)) drafts.delete(id);
    }
    if (!deleted && !next.tasks.some((task) => task.id === selectedRootTaskId && !task.deletedAtUtc && !task.parentTaskId)) selectedRootTaskId = liveTaskChildren(next, null)[0]?.id ?? null;
    if (render) renderPage();
  }

  async function refreshCanonical(preserveDraft = true, clearMessage = true): Promise<void> {
    if (deleted) return;
    canonicalReadError = null;
    const requestedId = projectId;
    const requestedGeneration = generation;
    const requestedDir = expectedDataDir;
    if (!requestedId) return;
    if (!project) setProjectPageLoading(page, true);
    try {
      const result = await productivityGetProject({ id: requestedId, expectedDataDir: requestedDir });
      if (!live() || deleted || requestedGeneration !== generation || requestedId !== projectId) return;
      applyCanonical(result.project, false);
      renderPage();
      void taskSidebar?.refresh();
      if (!preserveDraft) {
        detailDirty = false; detailFailed = false; detailDraft = null;
        previewPositions.clear(); failedPositions.clear();
      }
      if (clearMessage) setError("");
      syncDirty();
      applyPendingFocus();
    } catch (error) {
      if (!live() || deleted || requestedGeneration !== generation || requestedId !== projectId) return;
      canonicalReadError = error;
      page.loading.hidden = true;
      setError(`项目读取失败，页面未清空：${errorMessage(error)}`);
    }
  }

  function canonicalPosition(task: TaskSnapshot, index: number): Point {
    const stored = project?.taskCardPositions?.find((position) => position.taskId === task.id && !position.deletedAtUtc);
    if (stored) return { x: stored.x, y: stored.y };
    return { x: index * (PROJECT_TASK_CARD_SIZE.width + TASK_GRID_SIZE * 5), y: 0 };
  }

  function mapNodes(): ProjectMapNode[] {
    const snapshot = project;
    if (!snapshot || !selectedRootTaskId) return [];
    return liveTaskChildren(snapshot, selectedRootTaskId).map((task, index) => ({
      task,
      position: previewPositions.get(task.id) ?? failedPositions.get(task.id) ?? canonicalPosition(task, index),
      progress: projectMapProgressLabel(task.id, snapshot.tasks),
    }));
  }

  function scheduleMapRender(): void {
    if (disposed || frame !== null) return;
    frame = requestAnimationFrame(() => {
      frame = null;
      if (!disposed) renderMap();
    });
  }

  function mapEdgeInputs(): ProjectMapEdge[] {
    if (!project) return [];
    const ids = new Set(mapNodes().map((node) => node.task.id));
    return (project.taskSequenceEdges ?? []).filter((edge) => !edge.deletedAtUtc && ids.has(edge.sourceTaskId) && ids.has(edge.targetTaskId)).map((edge) => {
      const request = anchorDrag?.request.edgeId === edge.id && anchorDrag.candidate
        ? { ...anchorDrag.request, anchor: anchorDrag.candidate }
        : anchorDraft?.request.edgeId === edge.id ? anchorDraft.request : null;
      return request ? { ...edge, [request.endpoint === "source" ? "sourceAnchor" : "targetAnchor"]: request.anchor } : edge;
    });
  }

  function makeAnchorRequest(edgeId: string, endpoint: "source" | "target", anchor: TaskSequenceAnchor | null): SetTaskSequenceAnchorRequest | null {
    if (!live() || !project || deleted) return null;
    const edge = project.taskSequenceEdges?.find((value) => value.id === edgeId && !value.deletedAtUtc);
    const source = project.tasks.find((task) => task.id === edge?.sourceTaskId && !task.deletedAtUtc);
    const target = project.tasks.find((task) => task.id === edge?.targetTaskId && !task.deletedAtUtc);
    if (!edge || !source?.parentTaskId || source.parentTaskId !== target?.parentTaskId) return null;
    return { expectedDataDir, project: ref(project), edgeId, expectedSourceTaskId: edge.sourceTaskId, expectedTargetTaskId: edge.targetTaskId, expectedParentTaskId: source.parentTaskId, endpoint, anchor };
  }

  function showAnchorFailure(): void {
    setProjectPageError(page, `${anchorDraft?.error ? `${anchorDraft.error} ` : ""}连接点尚未保存，位置草稿已保留。请重试或放弃此次调整。`);
    const retry = createButton("重试", { width: 64, height: 34 });
    const discard = createButton("放弃调整", { width: 100, height: 34 });
    retry.addEventListener("click", () => {
      const previous = anchorDraft?.request;
      if (!previous || anchorSaving) return;
      const next = makeAnchorRequest(previous.edgeId, previous.endpoint, previous.anchor);
      if (!next || next.expectedSourceTaskId !== previous.expectedSourceTaskId || next.expectedTargetTaskId !== previous.expectedTargetTaskId || next.expectedParentTaskId !== previous.expectedParentTaskId) {
        setError("原顺序线或任务父级已变化，不能重试；请放弃原连接点草稿。");
        page.error.append(discard);
        return;
      }
      void saveAnchor(next);
    });
    discard.addEventListener("click", () => { if (anchorSaving) return; anchorDraft = null; syncDirty(); setError(""); renderMap(); });
    page.error.append(retry, discard);
  }

  async function saveAnchor(request: SetTaskSequenceAnchorRequest): Promise<void> {
    if (anchorSaving || !live()) return;
    anchorDraft = { request, failed: false };
    anchorSaving = true; syncDirty(); renderMap();
    // A drag owns its original revision/root/endpoints; queued writes must never rebind its intent.
    const result = await projectWrite(() => productivitySetTaskSequenceAnchor(request));
    anchorSaving = false;
    if (!live()) return;
    if (result) { anchorDraft = null; setError(""); }
    else { anchorDraft = { request, failed: true, error: page.error.textContent ?? "" }; showAnchorFailure(); }
    syncDirty(); renderMap();
  }

  function cancelAnchorDrag(): void {
    const pending = anchorDrag;
    anchorDrag = null;
    if (anchorFrame !== null) { cancelAnimationFrame(anchorFrame); anchorFrame = null; }
    if (pending && page.mapViewport.hasPointerCapture(pending.pointerId)) page.mapViewport.releasePointerCapture(pending.pointerId);
    syncDirty();
    if (!disposed && pending) { renderAnchorPreview(pending.request.edgeId); renderEdgeControls(); }
  }

  function renderAnchorPreview(edgeId: string): void {
    const edge = mapEdgeInputs().find((value) => value.id === edgeId);
    const nodes = mapNodes();
    const source = nodes.find((value) => value.task.id === edge?.sourceTaskId);
    const target = nodes.find((value) => value.task.id === edge?.targetTaskId);
    if (!edge || !source || !target) return;
    const curve = edgeCurve({ ...source.position, ...PROJECT_TASK_CARD_SIZE }, { ...target.position, ...PROJECT_TASK_CARD_SIZE }, edge.sourceAnchor, edge.targetAnchor);
    for (const path of page.mapEdges.querySelectorAll<SVGPathElement>("[data-edge-id]")) {
      if (path.dataset.edgeId === edgeId) path.setAttribute("d", `M ${curve.start.x} ${curve.start.y} C ${curve.control1.x} ${curve.control1.y}, ${curve.control2.x} ${curve.control2.y}, ${curve.end.x} ${curve.end.y}`);
    }
  }

  function clearHoverPin(immediate = false): void {
    hoverPin = null; hoverReady = false; hoverPoint = null;
    linkOverlay.replaceChildren();
    if (immediate || disposed || !live() || deleted || expandedTaskIds.size) removeHoverDots();
    else renderHoverDots();
  }

  function removeHoverDots(): void {
    for (const entry of hoverDots.values()) if (entry.removal !== null) window.clearTimeout(entry.removal);
    hoverDots.clear(); hoverOverlay.replaceChildren();
  }

  function renderHoverDots(): void {
    if (disposed || !live() || deleted || expandedTaskIds.size) { removeHoverDots(); return; }
    const nodes = mapNodes();
    const visible = new Set(nodes.map(({ task }) => task.id));
    for (const [key, entry] of hoverDots) if (!visible.has(entry.taskId)) {
      if (entry.removal !== null) window.clearTimeout(entry.removal);
      entry.group.remove(); hoverDots.delete(key);
    }
    const active = hoverPin && hoverReady && hoverPoint && !linkDrag ? nodes.find(({ task }) => task.id === hoverPin?.taskId) : null;
    const desired = new Map<string, { pin: LinkPin; point: Point; opacity: number }>();
    if (active && hoverPin && hoverPoint) {
      const bounds = { ...active.position, ...PROJECT_TASK_CARD_SIZE };
      const samples = cardAnchors(bounds).map((anchor) => {
        const point = anchorPoint(bounds, anchor);
        return { anchor, point, distance: Math.hypot(point.x - hoverPoint!.x, point.y - hoverPoint!.y) * camera.zoom };
      });
      const nearestDistance = Math.min(...samples.map(({ distance }) => distance));
      const nearestAnchor = hoverPin.anchor;
      const isActiveAnchor = (anchor: TaskSequenceAnchor) => anchor.side === nearestAnchor.side && anchor.offset === nearestAnchor.offset;
      for (const sample of samples.sort((a, b) => a.distance - b.distance || Number(isActiveAnchor(b.anchor)) - Number(isActiveAnchor(a.anchor))).slice(0, 3)) {
        // Smooth distance falloff: nearest = 1, then decay to zero over 72 screen pixels.
        const t = Math.max(0, 1 - (sample.distance - nearestDistance) / 72);
        const opacity = t * t * (3 - 2 * t);
        if (opacity <= .005) continue;
        const pin = { taskId: active.task.id, anchor: sample.anchor };
        desired.set(`${pin.taskId}:${pin.anchor.side}:${pin.anchor.offset}`, { pin, point: sample.point, opacity });
      }
    }
    const ns = "http://www.w3.org/2000/svg";
    for (const [key, value] of desired) {
      let entry = hoverDots.get(key);
      if (!entry) {
        const group = document.createElementNS(ns, "g");
        group.classList.add("project-page-v2__hover-pin");
        const reveal = document.createElementNS(ns, "g");
        reveal.classList.add("project-page-v2__link-pin-reveal");
        const hit = document.createElementNS(ns, "circle");
        hit.setAttribute("class", "project-page-v2__link-pin-hit");
        const dot = document.createElementNS(ns, "circle");
        dot.setAttribute("class", "project-page-v2__link-pin");
        dot.setAttribute("vector-effect", "non-scaling-stroke");
        reveal.append(hit, dot); group.append(reveal); hoverOverlay.append(group);
        entry = { taskId: value.pin.taskId, group, hit, dot, removal: null }; hoverDots.set(key, entry);
      }
      if (entry.removal !== null) { window.clearTimeout(entry.removal); entry.removal = null; }
      const card = [...page.mapCards.children].find((element) => (element as HTMLElement).dataset.taskId === value.pin.taskId) as HTMLElement | undefined;
      entry.group.style.color = card?.style.getPropertyValue("--project-task-selection-color") || "var(--insight-text-secondary)";
      entry.group.style.opacity = String(value.opacity);
      const isNearest = Boolean(hoverPin && value.pin.taskId === hoverPin.taskId && value.pin.anchor.side === hoverPin.anchor.side && value.pin.anchor.offset === hoverPin.anchor.offset);
      for (const [circle, radius] of [[entry.hit, 10], [entry.dot, 4]] as const) {
        circle.setAttribute("cx", String(value.point.x)); circle.setAttribute("cy", String(value.point.y)); circle.setAttribute("r", String(radius / camera.zoom));
      }
      entry.hit.style.pointerEvents = isNearest ? "all" : "none";
      if (isNearest) {
        entry.hit.dataset.linkPin = value.pin.taskId;
        entry.hit.dataset.linkSide = value.pin.anchor.side;
        entry.hit.dataset.linkOffset = String(value.pin.anchor.offset);
        entry.hit.setAttribute("aria-label", "拖动到另一张任务卡片以添加后续关系");
      } else { delete entry.hit.dataset.linkPin; entry.hit.removeAttribute("aria-label"); }
    }
    for (const [key, entry] of hoverDots) {
      if (desired.has(key)) continue;
      delete entry.hit.dataset.linkPin; entry.hit.removeAttribute("aria-label");
      entry.hit.style.pointerEvents = "none"; entry.group.style.opacity = "0";
      if (entry.removal !== null) continue;
      entry.removal = window.setTimeout(() => {
        if (hoverDots.get(key) !== entry) return;
        entry.group.remove(); hoverDots.delete(key);
      }, 180);
    }
  }

  function linkIsCurrent(intent: LinkIntent, requireTarget = true): boolean {
    const { request, parentTaskId } = intent;
    if (!live() || deleted || !project || projectId !== request.project.id || project.id !== request.project.id || project.revision !== request.project.expectedRevision || selectedRootTaskId !== parentTaskId) return false;
    const nodes = mapNodes();
    return nodes.some(({ task }) => task.id === request.sourceTaskId && task.parentTaskId === parentTaskId)
      && (!requireTarget || nodes.some(({ task }) => task.id === request.targetTaskId && task.parentTaskId === parentTaskId && task.id !== request.sourceTaskId));
  }

  function nearestLinkPin(point: Point, sourceId?: string): LinkPin | null {
    let best = Infinity;
    let result: LinkPin | null = null;
    const rect = page.mapViewport.getBoundingClientRect();
    const clientX = rect.left + camera.x + point.x * camera.zoom;
    const clientY = rect.top + camera.y + point.y * camera.zoom;
    if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) return null;
    const visibleCard = document.elementsFromPoint(clientX, clientY)
      .map((element) => element.closest<HTMLElement>(".project-page-v2__map-card[data-task-id]"))
      .find((card) => card && page.mapCards.contains(card));
    if (sourceId && visibleCard?.dataset.taskId === sourceId) return null;
    for (const node of mapNodes()) {
      if (node.task.id === sourceId) continue;
      if (visibleCard && visibleCard.dataset.taskId !== node.task.id) continue;
      const bounds = { ...node.position, ...PROJECT_TASK_CARD_SIZE };
      const dx = Math.max(bounds.x - point.x, 0, point.x - bounds.x - bounds.width);
      const dy = Math.max(bounds.y - point.y, 0, point.y - bounds.y - bounds.height);
      const inside = dx === 0 && dy === 0;
      const borderDistance = inside ? Math.min(point.x - bounds.x, bounds.x + bounds.width - point.x, point.y - bounds.y, bounds.y + bounds.height - point.y) : Math.hypot(dx, dy);
      if (!(sourceId && inside) && borderDistance > 12 / camera.zoom) continue;
      const anchor = snapCardAnchor(bounds, point, Infinity);
      if (!anchor) continue;
      const position = anchorPoint(bounds, anchor);
      const distance = Math.hypot(point.x - position.x, point.y - position.y);
      if (distance < best) { best = distance; result = { taskId: node.task.id, anchor }; }
    }
    return result;
  }

  function updateHoverPin(event: PointerEvent): void {
    if (event.pointerType === "touch" || event.buttons || !live() || deleted || expandedTaskIds.size || drag || marquee || pan || anchorDrag || anchorSaving || anchorDraft || linkDrag || linkSaving || linkDraft || writeCount || page.mapCards.querySelector("input, textarea")) { clearHoverPin(); return; }
    const point = mapScreenPoint(page, camera, event.clientX, event.clientY);
    const next = nearestLinkPin(point);
    hoverPin = next; hoverPoint = point; hoverReady = Boolean(next);
    renderHoverDots();
  }

  function renderLinkOverlay(): void {
    linkOverlay.replaceChildren();
    renderHoverDots();
    if (disposed || deleted || expandedTaskIds.size) return;
    const nodes = mapNodes();
    const ns = "http://www.w3.org/2000/svg";
    const pin = (value: LinkPin, interactive: boolean) => {
      const node = nodes.find(({ task }) => task.id === value.taskId);
      if (!node) return;
      const point = anchorPoint({ ...node.position, ...PROJECT_TASK_CARD_SIZE }, value.anchor);
      const group = document.createElementNS(ns, "g");
      const card = [...page.mapCards.children].find((element) => (element as HTMLElement).dataset.taskId === value.taskId) as HTMLElement | undefined;
      group.style.color = card?.style.getPropertyValue("--project-task-selection-color") || "var(--insight-text-secondary)";
      if (interactive) group.classList.add("project-page-v2__link-pin-reveal");
      for (const radius of [10, 4]) {
        const circle = document.createElementNS(ns, "circle");
        circle.setAttribute("cx", String(point.x)); circle.setAttribute("cy", String(point.y)); circle.setAttribute("r", String(radius / camera.zoom));
        circle.setAttribute("class", radius === 10 ? "project-page-v2__link-pin-hit" : "project-page-v2__link-pin");
        circle.setAttribute("vector-effect", "non-scaling-stroke");
        if (interactive && radius === 10) { circle.dataset.linkPin = value.taskId; circle.setAttribute("aria-label", "拖动到另一张任务卡片以添加后续关系"); }
        else circle.style.pointerEvents = "none";
        group.append(circle);
      }
      linkOverlay.append(group);
    };
    if (linkDrag) {
      const source = nodes.find(({ task }) => task.id === linkDrag?.intent.request.sourceTaskId);
      if (!source) return;
      const targetPin = linkDrag.target;
      const target = nodes.find(({ task }) => task.id === targetPin?.taskId);
      const from = { ...source.position, ...PROJECT_TASK_CARD_SIZE };
      const sourceAnchor = linkDrag.intent.request.sourceAnchor!;
      const curve = target && targetPin
        ? edgeCurve(from, { ...target.position, ...PROJECT_TASK_CARD_SIZE }, sourceAnchor, targetPin.anchor)
        : edgeCurveToPoint(from, sourceAnchor, linkDrag.point);
      const path = document.createElementNS(ns, "path");
      path.setAttribute("d", `M ${curve.start.x} ${curve.start.y} C ${curve.control1.x} ${curve.control1.y}, ${curve.control2.x} ${curve.control2.y}, ${curve.end.x} ${curve.end.y}`);
      path.setAttribute("class", "project-page-v2__link-preview");
      const card = [...page.mapCards.children].find((element) => (element as HTMLElement).dataset.taskId === source.task.id) as HTMLElement | undefined;
      path.style.color = card?.style.getPropertyValue("--project-task-selection-color") || "var(--insight-text-secondary)";
      linkOverlay.append(path);
      pin({ taskId: source.task.id, anchor: linkDrag.intent.request.sourceAnchor! }, false);
      if (targetPin) pin(targetPin, false);
    }
  }

  function cancelLinkDrag(): void {
    const pending = linkDrag; linkDrag = null;
    clearHoverPin();
    if (pending && page.mapViewport.hasPointerCapture(pending.pointerId)) page.mapViewport.releasePointerCapture(pending.pointerId);
    syncDirty();
  }

  function showLinkFailure(): void {
    setProjectPageError(page, `${linkError ? `${linkError} ` : ""}顺序线未保存，两个连接位置已保留。请重试或放弃连线。`);
    const retry = createButton("重试", { width: 64, height: 34 });
    const discard = createButton("放弃连线", { width: 100, height: 34 });
    retry.addEventListener("click", () => {
      if (!linkDraft || linkSaving || !project) return;
      const next = { ...linkDraft, request: { ...linkDraft.request, project: ref(project) } };
      // Explicit retry may adopt the refreshed revision only if the original tasks still share their parent.
      if (!linkIsCurrent(next)) { setProjectPageError(page, "原任务或父级已变化，请放弃此次连线。"); page.error.append(discard); return; }
      void saveLink(next);
    });
    discard.addEventListener("click", () => { if (linkSaving) return; linkDraft = null; syncDirty(); setError(""); });
    page.error.append(retry, discard);
  }

  async function saveLink(intent: LinkIntent): Promise<void> {
    if (linkSaving || !live()) return;
    linkDraft = intent; linkSaving = true; linkError = ""; syncDirty();
    // ADR-0046: preserve the gesture's root/revision and atomically write the edge with both anchors.
    const result = await projectWrite(() => {
      if (!linkIsCurrent(intent)) throw new Error("项目或任务父级在连线期间发生变化，请核对后重试。");
      return productivityAddTaskSequence(intent.request);
    });
    linkSaving = false;
    if (!live()) return;
    if (result) { linkDraft = null; setError(""); }
    else { linkError = page.error.textContent ?? ""; showLinkFailure(); }
    syncDirty();
  }

  function renderEdgeControls(): void {
    page.mapControls.replaceChildren(hoverOverlay, linkOverlay);
    if (linkDrag && !linkIsCurrent(linkDrag.intent, false)) cancelLinkDrag();
    renderLinkOverlay();
    const edge = mapEdgeInputs().find((value) => value.id === selectedEdgeId);
    for (const path of page.mapEdges.querySelectorAll<SVGPathElement>("[data-edge-id]")) path.classList.toggle("is-selected", path.dataset.edgeId === edge?.id);
    if (!edge || deleted) return;
    const nodes = mapNodes();
    const source = nodes.find((value) => value.task.id === edge.sourceTaskId);
    const target = nodes.find((value) => value.task.id === edge.targetTaskId);
    if (!source || !target) return;
    const from = { ...source.position, ...PROJECT_TASK_CARD_SIZE };
    const to = { ...target.position, ...PROJECT_TASK_CARD_SIZE };
    const curve = edgeCurve(from, to, edge.sourceAnchor, edge.targetAnchor);
    const svgNS = "http://www.w3.org/2000/svg";
    const circle = (point: Point, radius: number, className: string) => {
      const node = document.createElementNS(svgNS, "circle");
      node.setAttribute("cx", String(point.x)); node.setAttribute("cy", String(point.y));
      node.setAttribute("r", String(radius / camera.zoom)); node.setAttribute("class", className);
      page.mapControls.append(node); return node;
    };
    if (anchorDrag) {
      const bounds = anchorDrag.request.endpoint === "source" ? from : to;
      for (const anchor of cardAnchors(bounds)) circle(anchorPoint(bounds, anchor), 3, "project-page-v2__snap-point");
    }
    for (const endpoint of ["source", "target"] as const) {
      const point = endpoint === "source" ? curve.start : curve.end;
      const hit = circle(point, 10, "project-page-v2__edge-handle-hit");
      hit.dataset.edgeId = edge.id; hit.dataset.edgeHandle = endpoint;
      hit.setAttribute("tabindex", "0"); hit.setAttribute("role", "button");
      hit.setAttribute("aria-label", `${endpoint === "source" ? "起点" : "终点"}连接位置，拖动或用方向键切换吸附点`);
      hit.setAttribute("aria-disabled", String(anchorSaving || Boolean(anchorDraft?.failed)));
      const handle = circle(point, 4, "project-page-v2__edge-handle");
      const card = [...page.mapCards.children].find((element) => (element as HTMLElement).dataset.taskId === (endpoint === "source" ? source.task.id : target.task.id)) as HTMLElement | undefined;
      handle.style.stroke = card?.style.getPropertyValue("--project-task-selection-color") || "var(--insight-text-secondary)";
      handle.setAttribute("vector-effect", "non-scaling-stroke");
    }
    // A visible creation pin must receive presses even where an existing edge endpoint overlaps it.
    page.mapControls.append(linkOverlay);
    page.mapControls.append(hoverOverlay);
  }

  function renderMap(): void {
    const visible = new Set(mapNodes().map(({ task }) => task.id));
    if (hoverPin && (!visible.has(hoverPin.taskId) || expandedTaskIds.size)) clearHoverPin();
    for (const id of selectedMapTaskIds) if (!visible.has(id)) selectedMapTaskIds.delete(id);
    for (const id of expandedTaskIds) if (!visible.has(id)) expandedTaskIds.delete(id);
    const focusedId = [...expandedTaskIds][0] ?? null;
    page.mapLayer.dataset.taskFocused = String(Boolean(focusedId));
    const scrim = required<HTMLElement>(page.mapCards, "[data-map-scrim]");
    scrim.style.left = `${-camera.x / camera.zoom}px`;
    scrim.style.top = `${-camera.y / camera.zoom}px`;
    scrim.style.width = `${page.mapViewport.clientWidth / camera.zoom}px`;
    scrim.style.height = `${page.mapViewport.clientHeight / camera.zoom}px`;
    scrim.style.setProperty("--project-map-blur", `${6 / camera.zoom}px`);
    if (!project) {
      renderProjectMap(page, [], [], camera, selectedMapTaskId);
      renderEdgeControls();
      return;
    }
    const nodes = mapNodes();
    const edges = mapEdgeInputs();
    for (const id of failedTitles.keys()) {
      if (!project.tasks.some((task) => task.id === id && !task.deletedAtUtc)) failedTitles.delete(id);
    }
    renderProjectMap(page, nodes, edges, camera, selectedMapTaskId);
    for (const [id, controller] of cardTitles) {
      if (!controller.host.isConnected) { controller.field.dispose(); cardTitles.delete(id); }
    }
    for (const { task } of nodes) {
      const card = [...page.mapCards.children].find((node) => (node as HTMLElement).dataset.taskId === task.id) as HTMLElement;
      const titleHost = required<HTMLElement>(card, "[data-card-title]");
      let controller = cardTitles.get(task.id);
      if (!controller) {
        titleHost.replaceChildren();
        titleHost.setAttribute("data-inline-mounted", "");
        const field = mountInlineTextField({
          container: titleHost, value: failedTitles.get(task.id) ?? task.title, placeholder: "未命名任务", maxLength: 240,
          onCommit: (value) => {
            const title = value.trim();
            if (!title) { field.setValue(project?.tasks.find((value) => value.id === task.id)?.title ?? task.title); return; }
            if (title === project?.tasks.find((value) => value.id === task.id)?.title && !failedTitles.has(task.id)) return;
            failedTitles.set(task.id, title); syncDirty();
            void updateTask(task, { title }).then((result) => {
              if (result && failedTitles.get(task.id) === title) failedTitles.delete(task.id);
              syncDirty();
            });
          },
        });
        // Compose the standard editor's activation: first pointer click selects; the second edits.
        titleHost.addEventListener("click", (event) => {
          if (suppressMapClick) { event.stopImmediatePropagation(); return; }
          if ((event.target as Element).closest("input, textarea")) return;
          if (!expandedTaskIds.size && (event.shiftKey || event.ctrlKey || event.metaKey)) { event.stopImmediatePropagation(); toggleMapSelection(task.id); return; }
          if (event.detail === 1) {
            event.stopImmediatePropagation(); selectMapTask(task.id, false, selectedMapTaskIds.size > 1 && selectedMapTaskIds.has(task.id));
          }
        }, true);
        titleHost.addEventListener("click", (event) => event.stopPropagation());
        titleHost.addEventListener("dblclick", (event) => event.stopPropagation());
        controller = { host: titleHost, field }; cardTitles.set(task.id, controller);
      }
      controller.field.setReadOnly(deleted);
      controller.field.setValue(failedTitles.get(task.id) ?? task.title);
      const childrenHost = required<HTMLElement>(card, "[data-card-children]");
      const children = liveTaskChildren(project, task.id);
      const childrenKey = JSON.stringify(children.map((child) => [child.id, child.title]));
      if (childrenHost.dataset.childrenKey !== childrenKey) {
        childrenHost.dataset.childrenKey = childrenKey;
        childrenHost.replaceChildren(...children.map((child) => {
          const row = document.createElement("button"); row.type = "button";
          row.className = "insight-chat-rail-item project-page-v2__child-task";
          row.dataset.childTaskId = child.id; row.textContent = child.title;
          return row;
        }));
      }
      for (const child of childrenHost.querySelectorAll<HTMLElement>("[data-child-task-id]")) child.setAttribute("aria-pressed", String(child.dataset.childTaskId === selectedMapTaskId));
      const expanded = expandedTaskIds.has(task.id);
      const expansion = required<HTMLElement>(card, ".project-page-v2__card-expansion");
      const position = nodes.find((node) => node.task.id === task.id)!.position;
      const centerY = position.y + PROJECT_TASK_CARD_SIZE.height / 2;
      const viewportHeight = Math.max(1, page.mapViewport.clientHeight - 32);
      const focusScale = Math.min(1,
        Math.max(1, page.mapViewport.clientWidth - 32) / (PROJECT_TASK_CARD_SIZE.width * camera.zoom),
        viewportHeight / ((PROJECT_TASK_CARD_SIZE.height + 24) * camera.zoom));
      const effectiveZoom = camera.zoom * focusScale;
      const maxHeight = Math.max(PROJECT_TASK_CARD_SIZE.height, viewportHeight / effectiveZoom);
      const naturalHeight = Math.max(24, childrenHost.scrollHeight);
      const contentHeight = Math.min(naturalHeight, maxHeight - PROJECT_TASK_CARD_SIZE.height);
      const height = PROJECT_TASK_CARD_SIZE.height + (expanded ? contentHeight : 0);
      card.style.height = `${height}px`;
      // Grow equally around the card center; only move the whole preview when a canvas edge clips it.
      const minTop = (16 - camera.y) / camera.zoom;
      const maxTop = (page.mapViewport.clientHeight - 16 - camera.y) / camera.zoom - height * focusScale;
      const top = Math.max(minTop, Math.min(maxTop, centerY - height * focusScale / 2));
      const minLeft = (16 - camera.x) / camera.zoom;
      const maxLeft = (page.mapViewport.clientWidth - 16 - camera.x) / camera.zoom - PROJECT_TASK_CARD_SIZE.width * focusScale;
      const left = Math.max(minLeft, Math.min(maxLeft, position.x + PROJECT_TASK_CARD_SIZE.width * (1 - focusScale) / 2));
      card.style.transform = expanded ? `translate(${left - position.x}px, ${top - position.y}px) scale(${focusScale})` : "translate(0, 0) scale(1)";
      card.inert = Boolean(focusedId && focusedId !== task.id);
      card.setAttribute("aria-expanded", String(expanded));
      expansion.inert = !expanded;
    }
    renderEdgeControls();
    renderMapSelection();
    const failed = new Set(failedPositions.keys());
    page.mapCards.querySelectorAll<HTMLElement>("[data-task-id]").forEach((card) => {
      card.classList.toggle("is-position-failed", failed.has(card.dataset.taskId ?? ""));
      card.title = failed.has(card.dataset.taskId ?? "") ? "位置未保存；可再次拖动重试" : "单击展开子任务；双击标题改名；拖动调整位置";
    });
  }

  function renderMapSelection(): void {
    for (const card of page.mapCards.querySelectorAll<HTMLElement>("[data-task-id]")) card.setAttribute("aria-pressed", String(selectedMapTaskIds.has(card.dataset.taskId ?? "")));
    const box = required<HTMLElement>(page.mapCanvas, "[data-project-marquee]");
    box.hidden = !marquee?.moved;
    if (!marquee) return;
    box.style.left = `${Math.min(marquee.start.x, marquee.current.x)}px`;
    box.style.top = `${Math.min(marquee.start.y, marquee.current.y)}px`;
    box.style.width = `${Math.abs(marquee.current.x - marquee.start.x)}px`;
    box.style.height = `${Math.abs(marquee.current.y - marquee.start.y)}px`;
    box.style.borderWidth = `${1 / camera.zoom}px`;
  }

  function toggleMapSelection(id: string): void {
    if (selectedMapTaskIds.has(id)) selectedMapTaskIds.delete(id); else selectedMapTaskIds.add(id);
    selectedEdgeId = null; renderMapSelection(); renderEdgeControls();
  }

  function cancelMapGesture(): void {
    const pointerId = drag?.pointerId ?? marquee?.pointerId ?? pan?.pointerId;
    if (drag) for (const member of drag.members) previewPositions.delete(member.task.id);
    if (marquee && projectId === marquee.projectId && selectedRootTaskId === marquee.parentTaskId) {
      selectedMapTaskIds.clear(); for (const id of marquee.initialSelection) selectedMapTaskIds.add(id);
    }
    drag = null; marquee = null; pan = null;
    if (dragFrame !== null) { cancelAnimationFrame(dragFrame); dragFrame = null; }
    if (pointerId !== undefined && page.mapViewport.hasPointerCapture(pointerId)) page.mapViewport.releasePointerCapture(pointerId);
    syncDirty(); scheduleMapRender();
  }

  function selectMapTask(id: string, toggle: boolean, preserveSelection = false): void {
    if (!project || !live()) return;
    if (requestProjectNavigation({ mapTaskId: id, expandedTaskIds: toggle ? expandedTaskIds.has(id) ? [] : [id] : [...expandedTaskIds],
      sidebar: { taskId: id, selection: { kind: "task", id }, focusActionId: null } })) return;
    if (taskSidebar && !taskSidebar.select(id)) return;
    selectedMapTaskId = id; selectedEdgeId = null;
    if (!preserveSelection) { selectedMapTaskIds.clear(); if (mapNodes().some((node) => node.task.id === id)) selectedMapTaskIds.add(id); }
    if (toggle) {
      const wasExpanded = expandedTaskIds.has(id);
      expandedTaskIds.clear();
      if (!wasExpanded) expandedTaskIds.add(id);
    }
    renderMap();
  }

  function mountTaskControls(host: HTMLElement, task: TaskSnapshot, sortable: TaskSnapshot[], level: "first" | "third", owner = rowControls): void {
    const onContextMenu = (event: MouseEvent) => taskContextMenu(event, task);
    host.addEventListener("contextmenu", onContextMenu);
    owner.push({ dispose: () => host.removeEventListener("contextmenu", onContextMenu) });
    const titleHost = host.querySelector<HTMLElement>(`[data-project-title="${CSS.escape(task.id)}"]`);
    if (titleHost && level === "first") titleHost.textContent = task.title;
    if (titleHost && level !== "first") owner.push(mountInlineTextField({
      container: titleHost,
      value: task.title,
      placeholder: "未命名任务",
      readOnly: deleted,
      onCommit: (value) => { if (value.trim() && value !== task.title) void updateTask(task, { title: value.trim() }); },
    }));
    const progressHost = host.querySelector<HTMLElement>(`[data-project-progress="${CSS.escape(task.id)}"]`);
    const progress = project ? selectDirectChildProgress(task.id, project.tasks) : { kind: "no-children" as const, completed: 0, total: 0 };
    if (progressHost) {
      progressHost.textContent = progress.kind === "count" ? `${progress.completed}/${progress.total}` : progress.kind === "all-cancelled" ? `已取消 ${progress.cancelled}` : "";
      progressHost.setAttribute("aria-label", progress.kind === "count" ? `直属任务完成 ${progress.completed}/${progress.total}` : progress.kind === "all-cancelled" ? `直属任务均已取消，共 ${progress.cancelled} 项` : "没有直属任务");
    }
    const controls = host.querySelector<HTMLElement>(`[data-project-controls="${CSS.escape(task.id)}"]`);
    if (!controls) return;
    if (level !== "first") {
      const statusHost = document.createElement("div");
      controls.append(statusHost);
      owner.push(mountSelectField(statusHost, {
        label: `${task.title} 状态`,
        options: SELECT_OPTIONS,
        search: false,
        multiple: false,
        value: task.status,
        disabled: deleted,
        onChange: (value) => { if (value && value !== task.status) void setTaskStatus(task, value); },
      }));
    }
    const move = (delta: number) => {
      const ids = sortable.map((item) => item.id);
      const index = ids.indexOf(task.id);
      const target = Math.max(0, Math.min(ids.length - 1, index + delta));
      if (target === index || !project) return;
      ids.splice(index, 1); ids.splice(target, 0, task.id);
      void reorder(task.parentTaskId ?? null, sortable.map((item) => item.id), ids);
    };
    const more = document.createElement("button");
    more.type = "button";
    more.className = level === "first" ? "insight-chat-rail-new project-rail-entry" : "project-page-v2__task-menu";
    more.textContent = "⋯";
    more.setAttribute("aria-label", `${task.title}的更多操作`);
    more.setAttribute("aria-haspopup", "menu");
    more.setAttribute("aria-expanded", "false");
    let menu: ReturnType<typeof showCommandMenuAt> | null = null;
    owner.push({ dispose() { menu?.dispose(); menu = null; } });
    more.addEventListener("click", () => {
      if (menu) { menu.dispose(); menu = null; more.setAttribute("aria-expanded", "false"); return; }
      const rect = more.getBoundingClientRect();
      const index = sortable.findIndex((item) => item.id === task.id);
      more.setAttribute("aria-expanded", "true");
      menu = showCommandMenuAt(rect.right, rect.bottom, [
        { value: "up", label: "上移", disabled: index <= 0 },
        { value: "down", label: "下移", disabled: index >= sortable.length - 1 },
        ...(level === "first" ? [{ value: "detail", label: "编辑详情" }] : [{ value: "move", label: "移动到…" }]),
        ...(level === "first" ? [{ value: "status", label: "设置状态", children: SELECT_OPTIONS.map((option) => ({ value: `status:${option.value}`, label: option.label })) }] : []),
        { value: "complete-end", label: "完成并结束安排" },
        { value: "cancel", label: "取消任务" },
        { value: "delete", label: "删除任务", danger: true },
      ], (value) => {
        if (value === "up") move(-1);
        else if (value === "down") move(1);
        else if (value === "detail") openTaskDetail(task);
        else if (value === "move") void moveTaskToParent(task);
        else if (value === "complete-end") void lifecycle(task, "complete", "end");
        else if (value === "cancel") void lifecycle(task, "cancel", "preserve");
        else if (value === "delete") void deleteTask(task);
        else if (value.startsWith("status:")) void setTaskStatus(task, value.slice("status:".length));
      }, { returnFocus: more, onClose: () => { menu = null; more.setAttribute("aria-expanded", "false"); } });
    });
    controls.append(more);
    host.dataset.level = level;
  }

  function renderFirstLayer(): void {
    rowControls.forEach((control) => control.dispose());
    rowControls = [];
    if (!project || deleted) {
      page.firstTaskList.replaceChildren();
      return;
    }
    const tasks = liveTaskChildren(project, null);
    page.firstTaskList.innerHTML = tasks.map((task) => `<div class="insight-chat-rail-row" data-task-id="${escapeHtml(task.id)}"><button type="button" class="insight-chat-rail-item project-rail-entry${task.id === selectedRootTaskId ? " is-active" : ""}" data-project-title="${escapeHtml(task.id)}" title="${escapeHtml(task.title)}"></button><span class="project-rail-progress" data-project-progress="${escapeHtml(task.id)}"></span><div class="project-rail-row-controls" data-project-controls="${escapeHtml(task.id)}"></div></div>`).join("");
    if (!tasks.length) page.firstTaskList.innerHTML = `<p class="project-rail-empty">还没有一级任务</p>`;
    page.firstTaskList.querySelectorAll<HTMLElement>("[data-task-id]").forEach((row) => {
      const id = row.dataset.taskId;
      const task = tasks.find((item) => item.id === id);
      if (!task) return;
      const selectTask = () => {
        if (requestProjectNavigation({ rootTaskId: task.id, mapTaskId: null, expandedTaskIds: [], detailTaskId: null,
          sidebar: { taskId: null, selection: null, focusActionId: null } })) return;
        cancelLinkDrag();
        selectedRootTaskId = task.id;
        selectedMapTaskId = null;
        selectedEdgeId = null;
        if (anchorDrag) cancelAnchorDrag();
        renderPage();
        fitMap();
      };
      row.addEventListener("click", (event) => {
        if ((event.target as HTMLElement).closest("button, input, [role=combobox]")) return;
        selectTask();
      });
      mountTaskControls(row, task, tasks, "first");
      const select = required<HTMLButtonElement>(row, "button[data-project-title]");
      select.setAttribute("aria-label", `查看 ${task.title} 的路径图`);
      select.setAttribute("aria-pressed", String(task.id === selectedRootTaskId));
      select.addEventListener("click", selectTask);
    });
  }

  function renderPage(): void {
    if (!deleted) taskSidebar?.render();
    if (!project || deleted) {
      page.title.textContent = project?.title ?? "项目";
      page.firstLayer.hidden = true;
      page.mapLayer.hidden = true;
      page.loading.hidden = false;
      page.loading.textContent = deleted ? "此项目已删除，页面只读。" : "正在读取项目…";
      return;
    }
    setProjectPageProject(page, project);
    page.breadcrumb.replaceChildren();
    for (const [index, label] of [project.title, project.tasks.find((task) => task.id === selectedRootTaskId)?.title ?? "选择一级任务"].entries()) {
      if (index) { const separator = document.createElement("span"); separator.className = "project-page-v2__path-separator"; separator.textContent = ">"; separator.setAttribute("aria-hidden", "true"); page.breadcrumb.append(separator); }
      const part = document.createElement("span"); part.className = "project-page-v2__path-part"; part.textContent = label; part.title = label; page.breadcrumb.append(part);
    }
    renderFirstLayer();
    renderMap();
    if (detailDialog) renderOpenDetailRows?.();
  }

  async function projectWrite<T extends { project: ProjectSnapshot }>(operation: (current: ProjectSnapshot) => Promise<T>, preserveFailure: (() => void) | null = null): Promise<T | null> {
    const targetId = projectId;
    const targetGeneration = generation;
    const run = async (): Promise<T | null> => {
      if (!live() || !project || project.id !== targetId || deleted) return null;
      const current = project;
      writeCount += 1; syncDirty();
      try {
        const result = await operation(current);
        if (!live() || targetGeneration !== generation || projectId !== targetId) return null;
        applyCanonical(result.project);
        setError("");
        return result;
      } catch (error) {
        if (!live() || targetGeneration !== generation || projectId !== targetId) return null;
        if (isRevisionConflict(error)) {
          setError("项目在别处发生变化，已刷新最新内容；未保存草稿仍保留，请核对后再保存。");
          await refreshCanonical(true, false);
        } else setError(errorMessage(error));
        preserveFailure?.();
        syncDirty();
        return null;
      } finally {
        writeCount = Math.max(0, writeCount - 1); syncDirty();
      }
    };
    const result = writeQueue.then(run, run);
    writeQueue = result.then(() => undefined, () => undefined);
    return result;
  }

  function updateTask(task: TaskSnapshot, patch: { title?: string; description?: string | null; plannedPoint?: ProductivityPoint | null; duePoint?: ProductivityPoint | null }): Promise<ProjectSnapshot | null> {
    return projectWrite((current) => productivityUpdateTask({ expectedDataDir, project: ref(current), taskId: task.id, patch })).then((response) => response?.project ?? null);
  }

  function setTaskStatus(task: TaskSnapshot, status: string): Promise<ProjectSnapshot | null> {
    if (status === "完成") {
      void lifecycle(task, "complete", "preserve");
      return Promise.resolve(null);
    }
    if (status === "取消") {
      void lifecycle(task, "cancel", "preserve");
      return Promise.resolve(null);
    }
    return projectWrite((current) => productivitySetTaskStatusGuarded({ expectedDataDir, project: ref(current), taskId: task.id, status })).then((response) => response?.project ?? null);
  }

  function reorder(parentTaskId: string | null, expectedSiblingIds: string[], orderedSiblingIds: string[]): Promise<ProjectSnapshot | null> {
    return projectWrite((latest) => productivityReorderTaskSiblings({ expectedDataDir, project: ref(latest), parentTaskId, expectedSiblingIds, orderedSiblingIds })).then((response) => response?.project ?? null);
  }

  function openCreateTask(parentTaskId: string | null, initialPosition?: Point, anchor?: { taskId: string; placement: "before" | "after" }): void {
    const dialog = createInsightDialog({
      title: parentTaskId ? "新建子任务" : "新建第一层任务",
      panelClass: "project-page-v2__dialog",
      bodyHtml: `<label class="project-page-v2__dialog-field"><span>名称</span><input name="title" required maxlength="240" autocomplete="off"></label><div class="project-page-v2__dialog-field"><span>状态</span><div data-status></div></div>`,
      submitLabel: "创建",
    });
    const title = dialog.body.querySelector<HTMLInputElement>('[name="title"]')!;
    let statusValue = "未做";
    const status = mountSelectField(dialog.body.querySelector<HTMLElement>("[data-status]")!, {
      label: "任务状态", options: SELECT_OPTIONS, search: false, multiple: false, value: statusValue,
      onChange: (value) => { if (value) statusValue = value; },
    });
    dialog.bindChrome(() => { status.dispose(); void dialog.close().then(() => dialog.dispose()); });
    dialog.panel.addEventListener("submit", (event) => {
      event.preventDefault();
      const value = title.value.trim();
      if (!value || !project) { dialog.setError("请输入任务名称。"); title.focus(); return; }
      dialog.setBusy(true);
      void projectWrite((current) => productivityCreateTaskInProject({
        expectedDataDir, project: ref(current), title: value, status: statusValue, parentTaskId,
        ...(initialPosition ? { initialPosition } : {}),
        ...(anchor ? { newInitialSequence: { anchorTaskId: anchor.taskId, placement: anchor.placement } } : {}),
      })).then((result) => {
        dialog.setBusy(false);
        if (!result) { dialog.setError("创建失败；请查看页面错误并重试。"); return; }
        if (parentTaskId) selectedRootTaskId = project?.tasks.find((t) => t.id === parentTaskId)?.parentTaskId ?? selectedRootTaskId;
        status.dispose(); void dialog.close().then(() => dialog.dispose());
      });
    });
    void dialog.open();
  }

  function pointEditor(host: HTMLElement, value: ProductivityPoint | null | undefined, field: "plannedPoint" | "duePoint", draft: TaskDetailDraft, zone: BusinessTimeZoneResponse, onChange: () => void): void {
    const current = pointDateTime(value, zone);
    const precision = value?.precision ?? "none";
    const label = field === "plannedPoint" ? "计划时间" : "截止时间";
    host.innerHTML = `<div class="project-page-v2__point-row"><span>${label}</span><div class="project-page-v2__precision" data-precision></div><div class="project-page-v2__point-value" data-value></div></div>`;
    const precisionHost = host.querySelector<HTMLElement>("[data-precision]")!;
    let pickerHandle: { dispose: () => void } | null = null;
    let precisionControl: ReturnType<typeof mountSelectField> | null = null;
    precisionControl = mountSelectField(precisionHost, {
      label: `${label}类型`, search: false, multiple: false, value: precision,
      options: [{ value: "none", label: "无" }, { value: "date", label: "日期" }, { value: "instant", label: "日期时间" }],
      onChange: (next) => {
        pickerHandle?.dispose();
        pickerHandle = null;
        precisionControl?.dispose();
        const valueHost = host.querySelector<HTMLElement>("[data-value]")!;
        valueHost.replaceChildren();
        if (next === "none") draft[field] = null;
        const latest = pointDateTime(draft[field], zone);
        if (next === "date") draft[field] = latest.date ? { precision: "date", date: latest.date } : null;
        else if (next === "instant") draft[field] = latest.date ? { precision: "instant", atUtc: new Date(instantForWall(latest.date, latest.time ? Number(latest.time.slice(0, 2)) * 60 + Number(latest.time.slice(3, 5)) : 0, zone)).toISOString() } : null;
        onChange();
        pointEditor(host, draft[field] as ProductivityPoint | null, field, draft, zone, onChange);
      },
    });
    if (precisionControl) detailControls.push(precisionControl);
    const valueHost = host.querySelector<HTMLElement>("[data-value]")!;
    if (precision === "date") {
      pickerHandle = mountDecoupledDatePicker({ defaultTrigger: { container: valueHost, className: "project-page-v2__date-trigger" }, value: current.date, onChange: (date) => { draft[field] = date ? { precision: "date", date } : null; onChange(); } });
      detailPickers.push(pickerHandle);
    } else if (precision === "instant") {
      const dateTimePicker = mountDecoupledDateTimePicker({ defaultTrigger: { container: valueHost, className: "project-page-v2__date-trigger" }, value: current.date && current.time ? current : undefined, onChange: (next) => {
        draft[field] = next.date && next.time ? { precision: "instant", atUtc: new Date(instantForWall(next.date, Number(next.time.slice(0, 2)) * 60 + Number(next.time.slice(3, 5)), zone)).toISOString() } : null;
        onChange();
      } });
      pickerHandle = dateTimePicker;
      detailPickers.push(dateTimePicker);
      const clear = createButton("清除", { width: 100, height: 34 });
      clear.classList.add("project-page-v2__point-clear");
      clear.addEventListener("click", () => { draft[field] = null; dateTimePicker.setValue({ date: "", time: "" }); onChange(); });
      valueHost.append(clear);
    }
  }

  async function requestCloseDetail(): Promise<void> {
    if (!detailDialog || detailDialog.busy) return;
    if (detailDirty || detailFailed) {
      const discard = await getConfirmDialog()("放弃未保存的任务详情？", "当前详情修改尚未保存。放弃后将丢弃这份草稿。", undefined, { confirmLabel: "放弃修改", danger: true });
      if (!discard) return;
    }
    if (!applyingNavigation && context.navigation) {
      detailDirty = false; detailFailed = false;
      requestProjectNavigation({ detailTaskId: null, detailFocusTaskId: null }, true);
      return;
    }
    const handle = detailDialog;
    detailDialog = null;
    detailDirty = false; detailFailed = false; detailDraft = null;
    detailControls.forEach((control) => control.dispose()); detailControls = [];
    detailPickers.forEach((picker) => picker.dispose()); detailPickers = [];
    detailRowControls.forEach((control) => control.dispose()); detailRowControls = [];
    detailParentSelect?.dispose(); detailParentSelect = null;
    renderOpenDetailRows = null;
    syncDirty();
    await handle.close(); handle.dispose();
  }

  function openTaskDetail(task: TaskSnapshot, focusChildTaskId: string | null = null): void {
    if (requestProjectNavigation({ detailTaskId: task.id, detailFocusTaskId: focusChildTaskId })) return;
    if (!project || deleted || detailDialog) return;
    const parent = task.parentTaskId ?? null;
    detailParentId = task.id;
    detailFocusTaskId = focusChildTaskId;
    const draft: TaskDetailDraft = { taskId: task.id, title: task.title, description: task.description ?? "", plannedPoint: task.plannedPoint ?? null, duePoint: task.duePoint ?? null };
    detailDraft = draft;
    detailDirty = false; detailFailed = false;
    const secondLayerParents = liveTaskChildren(project, parent);
    const zoneRequest = productivityGetBusinessTimeZone();
    const dialog = createInsightDialog({
      title: "任务详情",
      bodyHtml: `<div class="project-page-v2__detail-layout"><div class="project-page-v2__detail-context" data-detail-context><span>切换任务</span><div class="project-page-v2__parent-picker"></div></div><div data-detail-form></div><section class="project-page-v2__children"><div class="project-page-v2__children-heading"><h3 data-detail-heading>子任务</h3></div><div class="project-page-v2__create" data-detail-create><input name="title" placeholder="添加子任务" maxlength="240"><button type="button" data-create-child data-project-compact>添加</button></div><div class="project-page-v2__task-list project-page-v2__task-list--flat" data-detail-list></div></section></div>`,
      submitLabel: "保存", cancelLabel: "关闭",
      panelClass: "project-page-v2__dialog project-page-v2__detail-dialog",
      navigationKind: "navigation-detail",
    });
    detailDialog = dialog;
    mountProjectButtons(dialog.body);
    const heading = dialog.body.querySelector<HTMLElement>("[data-detail-heading]")!;
    const parentHost = dialog.body.querySelector<HTMLElement>(".project-page-v2__parent-picker")!;
    const detailForm = dialog.body.querySelector<HTMLElement>("[data-detail-form]")!;
    const detailList = dialog.body.querySelector<HTMLElement>("[data-detail-list]")!;
    const createHost = dialog.body.querySelector<HTMLElement>("[data-detail-create]")!;
    const createInput = createHost.querySelector<HTMLInputElement>("[name=title]")!;
    const selectedTask = project.tasks.find((candidate) => candidate.id === draft.taskId)!;
    required<HTMLElement>(dialog.body, "[data-detail-context]").hidden = secondLayerParents.length < 2;
    detailForm.innerHTML = `<div class="project-page-v2__detail-fields"><div class="project-page-v2__property"><span class="project-page-v2__property-label">任务名称</span><div class="project-page-v2__title-value" data-title-field></div></div><div class="project-page-v2__property"><span class="project-page-v2__property-label">描述</span><div data-description-field></div></div><div data-planned-point></div><div data-due-point></div></div>`;
    const markDraft = () => { detailDirty = true; detailFailed = false; syncDirty(); };
    const titleContainer = detailForm.querySelector<HTMLElement>("[data-title-field]")!;
    detailControls.push(mountInlineTextField({ container: titleContainer, value: draft.title, placeholder: "任务名称", onCommit: (value) => { draft.title = value.trim(); markDraft(); } }));
    detailControls.push(mountInlineTextField({ container: detailForm.querySelector<HTMLElement>("[data-description-field]")!, value: draft.description, placeholder: "添加描述", multiline: true, onCommit: (value) => { draft.description = value; markDraft(); } }));
    void zoneRequest.then((zone: BusinessTimeZoneResponse) => {
      if (!live() || detailDialog !== dialog || detailDraft !== draft) return;
      pointEditor(detailForm.querySelector<HTMLElement>("[data-planned-point]")!, draft.plannedPoint, "plannedPoint", draft, zone, markDraft);
      pointEditor(detailForm.querySelector<HTMLElement>("[data-due-point]")!, draft.duePoint, "duePoint", draft, zone, markDraft);
    }).catch((error: unknown) => dialog.setError(`时间选项加载失败：${errorMessage(error)}`));
    detailParentSelect = secondLayerParents.length > 1 ? mountSelectField(parentHost, {
      label: "查看同层任务", search: false, multiple: false,
      options: secondLayerParents.map((value) => ({ value: value.id, label: value.title })),
      value: selectedTask.id,
      onChange: (nextParent) => {
        if (!nextParent || nextParent === detailParentId) return;
        void switchDetailParent(nextParent);
      },
    }) : null;
    const renderDetails = () => {
      if (!project || !detailParentId) return;
      const siblings = liveTaskChildren(project, detailParentId);
      heading.textContent = `子任务 · ${siblings.length}`;
      detailRowControls.forEach((control) => control.dispose());
      detailRowControls = [];
      renderProjectTaskRows(detailList, siblings, detailFocusTaskId);
      if (!siblings.length) detailList.innerHTML = `<p class="project-page-v2__children-empty">还没有子任务，在上方添加。</p>`;
      detailList.querySelectorAll<HTMLElement>("[data-task-id]").forEach((row) => {
        const sibling = siblings.find((candidate) => candidate.id === row.dataset.taskId);
        if (sibling) mountTaskControls(row, sibling, siblings, "third", detailRowControls);
      });
    };
    renderOpenDetailRows = renderDetails;
    function renderDetailBody(): void { renderDetails(); }
    const addChild = createHost.querySelector<HTMLButtonElement>("[data-create-child]")!;
    addChild.addEventListener("click", () => {
      const title = createInput.value.trim();
      if (!title || !project || !detailParentId) return;
      void projectWrite((current) => productivityCreateTaskInProject({ expectedDataDir, project: ref(current), title, status: "未做", parentTaskId: detailParentId })).then((result) => {
        if (result) { createInput.value = ""; renderDetailBody(); }
      });
    });
    createInput.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || event.isComposing) return;
      event.preventDefault();
      addChild.click();
    });
    dialog.bindChrome(() => { void requestCloseDetail(); });
    dialog.panel.addEventListener("submit", (event) => {
      event.preventDefault();
      const latestTask = project?.tasks.find((candidate) => candidate.id === draft.taskId);
      if (!latestTask) { dialog.setError("任务已不存在；详情草稿仍保留在此处。"); return; }
      detailSaving = true; dialog.setBusy(true); syncDirty();
      void updateTask(latestTask, { title: draft.title, description: draft.description || null, plannedPoint: draft.plannedPoint, duePoint: draft.duePoint }).then((result) => {
        detailSaving = false; dialog.setBusy(false);
        if (!result) { detailFailed = true; syncDirty(); return; }
        detailDirty = false; detailFailed = false; detailDraft = null; syncDirty();
        void requestCloseDetail();
      });
    });
    titleContainer.querySelector<HTMLButtonElement>("button")?.setAttribute("autofocus", "");
    renderDetails();
    void dialog.open();

    async function switchDetailParent(nextParent: string): Promise<void> {
      if (requestProjectNavigation({ detailTaskId: nextParent, detailFocusTaskId: null })) return;
      if (detailDirty || detailFailed) {
        const discard = await getConfirmDialog()("切换任务并放弃草稿？", "第三层任务详情尚未保存。切换后将丢弃这份草稿。", undefined, { confirmLabel: "放弃并切换", danger: true });
        if (!discard) { detailParentSelect?.setValue(detailParentId); return; }
      }
      const nextTask = project?.tasks.find((candidate) => candidate.id === nextParent);
      if (!nextTask || !detailDialog) return;
      const oldDialog = detailDialog;
      detailDialog = null; renderOpenDetailRows = null;
      detailDirty = false; detailFailed = false; detailDraft = null; syncDirty();
      detailControls.forEach((control) => control.dispose()); detailControls = [];
      detailPickers.forEach((picker) => picker.dispose()); detailPickers = [];
      detailRowControls.forEach((control) => control.dispose()); detailRowControls = [];
      detailParentSelect?.dispose(); detailParentSelect = null;
      await oldDialog.close(); oldDialog.dispose();
      openTaskDetail(nextTask);
    }
  }

  function fitMap(): void {
    if (linkDrag) return;
    clearHoverPin();
    const nodes = mapNodes();
    const rect = page.mapViewport.getBoundingClientRect();
    const left = 16;
    const top = 16;
    const bottom = 72;
    const width = rect.width - left - 16;
    const height = rect.height - top - bottom;
    if (width <= 0 || height <= 0) { renderMap(); return; }
    const padding = Math.min(48, width / 4, height / 4);
    camera = fitAll(nodes.map(({ position }) => ({ ...position, ...PROJECT_TASK_CARD_SIZE })), { width, height }, { padding });
    camera = { ...camera, x: camera.x + left, y: camera.y + top };
    renderMap();
  }

  page.mapLayer.querySelectorAll<HTMLButtonElement>("[data-project-zoom]").forEach((button) => {
    button.addEventListener("click", () => {
      if (drag || marquee || pan || anchorDrag || linkDrag) return;
      clearHoverPin();
      const rect = page.mapViewport.getBoundingClientRect();
      const factor = button.dataset.projectZoom === "in" ? 1.2 : 1 / 1.2;
      const nextZoom = Math.min(2.5, Math.max(0.25, camera.zoom * factor));
      camera = zoomAt(camera, { x: rect.width / 2, y: rect.height / 2 }, nextZoom);
      renderMap();
    });
  });

  function savePosition(task: TaskSnapshot, position: Point, snap = true, intent?: MapDragIntent): void {
    const next = snapPoint(position, snap);
    previewPositions.delete(task.id);
    failedPositions.set(task.id, next);
    syncDirty();
    const parentId = intent?.parentTaskId ?? task.parentTaskId ?? null;
    void projectWrite((current) => {
      if (intent && !dragIsCurrent(intent, current)) throw new Error("PROJECT_POSITION_INTENT_STALE");
      return productivitySetTaskCardPosition({
        expectedDataDir: intent?.expectedDataDir ?? expectedDataDir,
        project: intent ? { id: intent.projectId, expectedRevision: intent.projectRevision } : ref(current),
        taskId: intent?.taskId ?? task.id,
        expectedParentTaskId: parentId,
        x: next.x,
        y: next.y,
      });
    }).then((result) => {
      if (result && failedPositions.get(task.id) === next) failedPositions.delete(task.id);
      else if (!result && intent && live()) setPositionDraftError("拖动期间的项目快照已变化，服务端没有按新快照重放旧拖动。", task.id, failedPositions.get(task.id) ?? next);
      scheduleMapRender(); syncDirty();
    });
  }

  function saveGroupPositions(intent: MapDrag): void {
    const positions = intent.members.map((member) => ({ taskId: member.task.id, point: previewPositions.get(member.task.id) ?? member.position }));
    for (const entry of positions) { previewPositions.delete(entry.taskId); failedPositions.set(entry.taskId, entry.point); }
    syncDirty();
    // One captured revision and one transaction keep a group move all-or-nothing (docs/adr/0046-project-path-map.md).
    void projectWrite((current) => {
      if (selectedRootTaskId !== intent.parentTaskId || intent.members.some((member) => !dragIsCurrent({ ...intent, taskId: member.task.id, originalPosition: member.position }, current))) throw new Error("PROJECT_POSITION_INTENT_STALE");
      return productivitySetTaskCardPositions({
        expectedDataDir: intent.expectedDataDir,
        project: { id: intent.projectId, expectedRevision: intent.projectRevision },
        expectedParentTaskId: intent.parentTaskId,
        positions: positions.map(({ taskId, point }) => ({ taskId, x: point.x, y: point.y })),
      });
    }).then((result) => {
      if (!live()) return;
      if (result) {
        for (const entry of positions) if (failedPositions.get(entry.taskId) === entry.point) failedPositions.delete(entry.taskId);
      } else {
        const first = positions[0];
        if (first) setPositionDraftError("这组卡片的位置未保存，整组位置草稿已保留。", first.taskId, first.point);
      }
      scheduleMapRender(); syncDirty();
    });
  }

  function onMapPointerDown(event: PointerEvent): void {
    if (linkDrag) return;
    if (drag || marquee || pan) return;
    if (anchorDrag) return;
    if (expandedTaskIds.size) return;
    if ((event.target as Element).closest("[data-card-children], input, textarea")) return;
    const pin = (event.target as Element).closest("[data-link-pin]");
    if (pin && event.button === 0 && !spaceDown && hoverPin && hoverReady && pin.getAttribute("data-link-pin") === hoverPin.taskId && pin.getAttribute("data-link-side") === hoverPin.anchor.side && Number(pin.getAttribute("data-link-offset")) === hoverPin.anchor.offset && project && selectedRootTaskId && live() && !deleted && !anchorSaving && !anchorDraft && !linkSaving && !linkDraft && !writeCount) {
      const source = hoverPin;
      linkDrag = { intent: { request: { expectedDataDir, project: ref(project), sourceTaskId: source.taskId, targetTaskId: "", sourceAnchor: source.anchor }, parentTaskId: selectedRootTaskId }, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, point: mapScreenPoint(page, camera, event.clientX, event.clientY), target: null };
      page.mapViewport.focus({ preventScroll: true });
      // The window owns this gesture (see mapEvents), independent of the small SVG hit target.
      hoverPin = null; hoverReady = false;
      selectedEdgeId = null;
      event.preventDefault(); event.stopPropagation(); syncDirty();
      renderEdgeControls();
      return;
    }
    if (pin) return;
    clearHoverPin();
    const handle = (event.target as Element).closest<SVGCircleElement>("[data-edge-handle]");
    if (handle) {
      if (event.button !== 0 || anchorSaving || anchorDraft?.failed || !project) return;
      const endpoint = handle.dataset.edgeHandle;
      const edge = mapEdgeInputs().find((value) => value.id === handle.dataset.edgeId);
      if (!edge || (endpoint !== "source" && endpoint !== "target")) return;
      const request = makeAnchorRequest(edge.id, endpoint, (endpoint === "source" ? edge.sourceAnchor : edge.targetAnchor) ?? null);
      if (!request) return;
      anchorDrag = { request, pointerId: event.pointerId, candidate: null };
      page.mapViewport.setPointerCapture(event.pointerId);
      page.mapViewport.focus({ preventScroll: true });
      event.preventDefault(); syncDirty(); renderEdgeControls(); return;
    }
    const card = (event.target as HTMLElement).closest<HTMLElement>("[data-task-id]");
    if (card?.dataset.taskId && !(event.button === 1 || (event.button === 0 && spaceDown))) {
      if (event.button !== 0) return;
      const task = project?.tasks.find((candidate) => candidate.id === card.dataset.taskId);
      if (!task || !project || !projectId || deleted) return;
      const nodes = mapNodes();
      const index = nodes.findIndex((node) => node.task.id === task.id);
      const position = previewPositions.get(task.id) ?? failedPositions.get(task.id) ?? canonicalPosition(task, index);
      const rect = page.mapViewport.getBoundingClientRect();
      const world = screenToWorld({ x: event.clientX - rect.left, y: event.clientY - rect.top }, camera);
      const additive = event.shiftKey || event.ctrlKey || event.metaKey;
      const memberIds = selectedMapTaskIds.has(task.id) || additive ? new Set([...selectedMapTaskIds, task.id]) : new Set([task.id]);
      if (!additive && !selectedMapTaskIds.has(task.id)) { selectedMapTaskIds.clear(); selectedMapTaskIds.add(task.id); renderMapSelection(); }
      drag = {
        projectId,
        generation,
        expectedDataDir,
        projectRevision: project.revision,
        taskId: task.id,
        parentTaskId: task.parentTaskId ?? null,
        originalPosition: { ...position },
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        offset: { x: world.x - position.x, y: world.y - position.y },
        moved: false,
        committed: false,
        alt: event.altKey,
        members: nodes.filter((node) => memberIds.has(node.task.id)).map((node) => ({ task: node.task, position: { ...node.position } })),
      };
      return;
    }
    if ((event.button === 1 || (event.button === 0 && spaceDown)) && !deleted) {
      pan = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, camera: { ...camera } };
      page.mapViewport.setPointerCapture(event.pointerId);
      event.preventDefault();
      return;
    }
    if (event.button === 0 && live() && project && projectId && selectedRootTaskId && !deleted && !(event.target as Element).closest("[data-edge-id]")) {
      const start = mapScreenPoint(page, camera, event.clientX, event.clientY);
      marquee = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, start, current: start, camera: { ...camera }, moved: false, projectId, parentTaskId: selectedRootTaskId, initialSelection: new Set(selectedMapTaskIds), additive: event.shiftKey || event.ctrlKey || event.metaKey };
      page.mapViewport.setPointerCapture(event.pointerId);
      page.mapViewport.focus({ preventScroll: true });
      event.preventDefault();
    }
  }

  function onMapPointerMove(event: PointerEvent): void {
    if (linkDrag?.pointerId === event.pointerId) {
      if (!linkIsCurrent(linkDrag.intent, false)) { cancelLinkDrag(); setError("项目在拖线期间发生变化，本次连线已取消。"); return; }
      linkDrag.point = mapScreenPoint(page, camera, event.clientX, event.clientY);
      linkDrag.target = nearestLinkPin(linkDrag.point, linkDrag.intent.request.sourceTaskId);
      renderLinkOverlay(); return;
    }
    updateHoverPin(event);
    if (marquee?.pointerId === event.pointerId) {
      if (!live() || projectId !== marquee.projectId || selectedRootTaskId !== marquee.parentTaskId) { cancelMapGesture(); return; }
      if (!marquee.moved && Math.hypot(event.clientX - marquee.startX, event.clientY - marquee.startY) < 5) return;
      marquee.moved = true;
      marquee.current = mapScreenPoint(page, marquee.camera, event.clientX, event.clientY);
      const left = Math.min(marquee.start.x, marquee.current.x), right = Math.max(marquee.start.x, marquee.current.x);
      const top = Math.min(marquee.start.y, marquee.current.y), bottom = Math.max(marquee.start.y, marquee.current.y);
      selectedMapTaskIds.clear();
      if (marquee.additive) for (const id of marquee.initialSelection) selectedMapTaskIds.add(id);
      for (const node of mapNodes()) {
        if (node.position.x <= right && node.position.x + PROJECT_TASK_CARD_SIZE.width >= left && node.position.y <= bottom && node.position.y + PROJECT_TASK_CARD_SIZE.height >= top) selectedMapTaskIds.add(node.task.id);
      }
      selectedEdgeId = null; renderMapSelection(); renderEdgeControls();
      return;
    }
    if (anchorDrag?.pointerId === event.pointerId) {
      if (!live() || !project || project.id !== anchorDrag.request.project.id || project.revision !== anchorDrag.request.project.expectedRevision) {
        cancelAnchorDrag(); setError("项目在拖动期间发生变化，本次连接点调整已取消。"); return;
      }
      const taskId = anchorDrag.request.endpoint === "source" ? anchorDrag.request.expectedSourceTaskId : anchorDrag.request.expectedTargetTaskId;
      const node = mapNodes().find((value) => value.task.id === taskId);
      if (!node) { cancelAnchorDrag(); return; }
      anchorDrag.candidate = snapCardAnchor({ ...node.position, ...PROJECT_TASK_CARD_SIZE }, mapScreenPoint(page, camera, event.clientX, event.clientY), 18 / camera.zoom);
      if (anchorFrame === null) anchorFrame = requestAnimationFrame(() => {
        anchorFrame = null;
        if (anchorDrag) { renderAnchorPreview(anchorDrag.request.edgeId); renderEdgeControls(); }
      });
      return;
    }
    if (drag?.pointerId === event.pointerId) {
      const dx = event.clientX - drag.startX; const dy = event.clientY - drag.startY;
      if (!drag.moved && Math.hypot(dx, dy) < 5) return;
      // Keep click targets stable until an actual drag; viewport capture would retarget double-clicks.
      if (!drag.moved) mapDragCaptureTarget(page).setPointerCapture(event.pointerId);
      drag.moved = true; drag.alt = event.altKey;
      selectedMapTaskIds.clear(); for (const member of drag.members) selectedMapTaskIds.add(member.task.id);
      selectedEdgeId = null; renderMapSelection();
      const current = screenToWorld({ x: drag.startX + dx - page.mapViewport.getBoundingClientRect().left, y: drag.startY + dy - page.mapViewport.getBoundingClientRect().top }, camera);
      const offsetX = drag.offset.x;
      const offsetY = drag.offset.y;
      const preview = snapPoint({ x: current.x - offsetX, y: current.y - offsetY }, !event.altKey);
      const delta = { x: preview.x - drag.originalPosition.x, y: preview.y - drag.originalPosition.y };
      const members = drag.members;
      for (const member of members) previewPositions.set(member.task.id, { x: member.position.x + delta.x, y: member.position.y + delta.y });
      syncDirty();
      if (dragFrame === null) dragFrame = requestAnimationFrame(() => {
        dragFrame = null;
        const nodes = mapNodes(); const edges = mapEdgeInputs();
        for (const member of members) updateProjectMapPositionInPlace(page, nodes, member.task.id, previewPositions.get(member.task.id) ?? member.position, edges);
        renderEdgeControls();
      });
      return;
    }
    if (pan?.pointerId === event.pointerId) {
      camera = { ...pan.camera, x: pan.camera.x + event.clientX - pan.x, y: pan.camera.y + event.clientY - pan.y };
      scheduleMapRender();
    }
  }

  function onMapPointerUp(event: PointerEvent): void {
    if (linkDrag?.pointerId === event.pointerId) {
      const ended = linkDrag;
      const target = nearestLinkPin(mapScreenPoint(page, camera, event.clientX, event.clientY), ended.intent.request.sourceTaskId);
      cancelLinkDrag();
      suppressMapClick = true; window.setTimeout(() => { suppressMapClick = false; }, 0);
      if (event.type !== "pointercancel" && Math.hypot(event.clientX - ended.startX, event.clientY - ended.startY) >= 5 && target && linkIsCurrent(ended.intent, false)) {
        void saveLink({ ...ended.intent, request: { ...ended.intent.request, targetTaskId: target.taskId, targetAnchor: target.anchor } });
      }
      return;
    }
    if (event.type === "pointercancel" && !anchorDrag) { cancelMapGesture(); return; }
    if (marquee?.pointerId === event.pointerId) {
      const moved = marquee.moved; marquee = null;
      if (page.mapViewport.hasPointerCapture(event.pointerId)) page.mapViewport.releasePointerCapture(event.pointerId);
      if (moved) { suppressMapClick = true; window.setTimeout(() => { suppressMapClick = false; }, 0); }
      renderMapSelection(); return;
    }
    if (anchorDrag?.pointerId === event.pointerId) {
      const ended = anchorDrag;
      anchorDrag = null;
      if (anchorFrame !== null) { cancelAnimationFrame(anchorFrame); anchorFrame = null; }
      if (page.mapViewport.hasPointerCapture(event.pointerId)) page.mapViewport.releasePointerCapture(event.pointerId);
      suppressMapClick = true;
      window.setTimeout(() => { suppressMapClick = false; }, 0);
      const taskId = ended.request.endpoint === "source" ? ended.request.expectedSourceTaskId : ended.request.expectedTargetTaskId;
      const node = mapNodes().find((value) => value.task.id === taskId);
      const candidate = node ? snapCardAnchor({ ...node.position, ...PROJECT_TASK_CARD_SIZE }, mapScreenPoint(page, camera, event.clientX, event.clientY), 18 / camera.zoom) : null;
      if (event.type !== "pointercancel" && candidate && live() && project?.id === ended.request.project.id && project.revision === ended.request.project.expectedRevision) {
        void saveAnchor({ ...ended.request, anchor: candidate });
      } else { syncDirty(); renderMap(); }
      return;
    }
    if (drag?.pointerId === event.pointerId) {
      const ended = drag; drag = null;
      if (page.mapViewport.hasPointerCapture(event.pointerId)) page.mapViewport.releasePointerCapture(event.pointerId);
      if (consumeMapDragCommit(ended)) {
        if (dragFrame !== null) { cancelAnimationFrame(dragFrame); dragFrame = null; }
        const nodes = mapNodes(); const edges = mapEdgeInputs();
        for (const member of ended.members) {
          const finalPreview = previewPositions.get(member.task.id);
          if (finalPreview) updateProjectMapPositionInPlace(page, nodes, member.task.id, finalPreview, edges);
        }
        suppressMapClick = true;
        window.setTimeout(() => { suppressMapClick = false; }, 0);
        if (ended.members.length > 1) { saveGroupPositions(ended); return; }
        const task = project?.tasks.find((candidate) => candidate.id === ended.taskId);
        const position = previewPositions.get(ended.taskId);
        if (position) {
          previewPositions.delete(ended.taskId);
          if (!dragIsCurrent(ended)) {
            failedPositions.set(ended.taskId, position);
            setPositionDraftError("项目根、版本或任务父级在拖动期间发生变化。", ended.taskId, position);
            scheduleMapRender();
          } else if (task) savePosition(task, position, !event.altKey, ended);
          syncDirty();
        }
      }
      return;
    }
    if (pan?.pointerId === event.pointerId) pan = null;
  }

  function onMapWheel(event: WheelEvent): void {
    if (expandedTaskIds.size && (event.target as Element).closest(".project-page-v2__card-expansion")) return;
    event.preventDefault();
    if (linkDrag) return;
    clearHoverPin();
    if (drag || marquee || pan) return;
    if (expandedTaskIds.size) return;
    if (anchorDrag) return;
    const rect = page.mapViewport.getBoundingClientRect();
    const nextZoom = Math.min(2.5, Math.max(0.25, camera.zoom * Math.exp(-event.deltaY * 0.001)));
    camera = zoomAt(camera, { x: event.clientX - rect.left, y: event.clientY - rect.top }, nextZoom);
    scheduleMapRender();
  }

  function taskStatusMenu(task: TaskSnapshot): CommandMenuItem {
    return { value: "status", label: "状态", children: [
      ...TASK_STATUSES.map((status) => ({ value: `status:${status}`, label: status, disabled: status === task.status, danger: status === "取消" })),
      { value: "complete-end", label: "完成并结束相关安排" },
    ] };
  }

  function taskContextMenu(event: MouseEvent, task: TaskSnapshot): void {
    event.preventDefault(); event.stopPropagation();
    if (!live() || !project || deleted || task.deletedAtUtc) return;
    const originId = project.id;
    edgeContextMenu?.dispose();
    edgeContextMenu = showCommandMenuAt(event.clientX, event.clientY, [
      taskStatusMenu(task),
      { value: "delete", label: "删除任务", danger: true },
    ], (value) => {
      if (!live() || project?.id !== originId) return;
      const current = project.tasks.find((candidate) => candidate.id === task.id && !candidate.deletedAtUtc);
      if (!current) return;
      if (value === "delete") void deleteTask(current);
      else if (value === "complete-end") void lifecycle(current, "complete", "end");
      else if (value.startsWith("status:") && current.status !== value.slice(7)) void setTaskStatus(current, value.slice(7));
    }, { returnFocus: event.target instanceof HTMLElement ? event.target : null, onClose: () => { edgeContextMenu = null; } });
  }

  function relationMenu(event: MouseEvent, task: TaskSnapshot): void {
    event.preventDefault();
    if (!live() || !project || deleted) return;
    const originId = project.id;
    const originParentId = task.parentTaskId ?? null;
    const sameLevel = liveTaskChildren(project, selectedRootTaskId).filter((candidate) => candidate.id !== task.id);
    const edges = project.taskSequenceEdges ?? [];
    const menu: CommandMenuItem[] = [
      taskStatusMenu(task),
      { value: "delete", label: "删除任务", danger: true },
      { value: "add-task", label: "添加任务", children: [
        { value: "add-before", label: "添加前置任务" },
        { value: "add-after", label: "添加后续任务" },
        { value: "new-child", label: "添加子任务" },
      ] },
      { value: "edit", label: "编辑详情" },
      { value: "move", label: "移动到…" },
      { value: "sequence", label: "顺序关系", disabled: !sameLevel.length && !edges.some((edge) => !edge.deletedAtUtc && (edge.sourceTaskId === task.id || edge.targetTaskId === task.id)), children: [
      ...edges.filter((edge) => !edge.deletedAtUtc && (edge.sourceTaskId === task.id || edge.targetTaskId === task.id)).map((edge) => ({ value: `remove:${edge.id}`, label: "解除顺序关系" })),
      ...sameLevel.map((candidate) => ({ value: `connect-before:${candidate.id}`, label: `添加 ${candidate.title} 的后续关系` })),
      ...sameLevel.map((candidate) => ({ value: `connect-after:${candidate.id}`, label: `添加 ${candidate.title} 的前置关系` })),
      ] },
    ];
    edgeContextMenu?.dispose();
    edgeContextMenu = showCommandMenuAt(event.clientX, event.clientY, menu, (value) => {
      if (!live() || project?.id !== originId || selectedRootTaskId !== originParentId || !project.tasks.some((candidate) => candidate.id === task.id && !candidate.deletedAtUtc && (candidate.parentTaskId ?? null) === originParentId)) return;
      const current = project.tasks.find((candidate) => candidate.id === task.id)!;
      if (value === "add-before" || value === "add-after") openCreateTask(selectedRootTaskId, preferredPositionForSequence({ ...mapNodes().find((node) => node.task.id === task.id)!.position, ...PROJECT_TASK_CARD_SIZE }, value === "add-before" ? "before" : "after", PROJECT_TASK_CARD_SIZE), { taskId: task.id, placement: value === "add-before" ? "before" : "after" });
      else if (value === "new-child") openCreateTask(task.id);
      else if (value === "edit") openTaskDetail(task);
      else if (value === "delete") void deleteTask(current);
      else if (value === "complete-end") void lifecycle(current, "complete", "end");
      else if (value.startsWith("status:") && current.status !== value.slice(7)) void setTaskStatus(current, value.slice(7));
      else if (value === "move") void moveTaskToParent(task);
      else if (value.startsWith("remove:")) void removeSequence(value.slice(7));
      else if (value.startsWith("connect-before:")) void addSequence(value.slice(15), task.id);
      else if (value.startsWith("connect-after:")) void addSequence(task.id, value.slice(14));
    }, { returnFocus: event.target instanceof HTMLElement ? event.target : null, onClose: () => { edgeContextMenu = null; } });
  }

  async function addSequence(sourceTaskId: string, targetTaskId: string): Promise<void> {
    await projectWrite((current) => productivityAddTaskSequence({ expectedDataDir, project: ref(current), sourceTaskId, targetTaskId }));
  }

  async function removeSequence(edgeId: string): Promise<void> {
    if (anchorSaving || anchorDrag) return;
    const result = await projectWrite((current) => productivityRemoveTaskSequence({ expectedDataDir, project: ref(current), edgeId }));
    if (result) {
      if (anchorDraft?.request.edgeId === edgeId) anchorDraft = null;
      if (selectedEdgeId === edgeId) selectedEdgeId = null;
      syncDirty(); setError(""); renderMap();
    }
  }

  async function moveTaskToParent(task: TaskSnapshot): Promise<void> {
    if (!project) return;
    const sourceParent = task.parentTaskId ?? null;
    if (!sourceParent) { setError("第一层任务通过同层排序调整位置。"); return; }
    const parentOfSource = sourceParent ? project.tasks.find((candidate) => candidate.id === sourceParent)?.parentTaskId ?? null : null;
    const targets = liveTaskChildren(project, parentOfSource).filter((candidate) => candidate.id !== sourceParent);
    if (!targets.length) { setError("没有同层的可移动目标。"); return; }
    const options = targets.map((target) => ({ value: target.id, label: target.title }));
    const selected = await chooseFromDialog("移动到同层任务的父级", options);
    if (!selected) return;
    const sourceIds = liveTaskChildren(project, sourceParent).map((candidate) => candidate.id);
    const targetIds = liveTaskChildren(project, selected).map((candidate) => candidate.id);
    const position = findOpenCardPosition({ x: 0, y: 0 }, targetIds.map((id, index) => {
      const target = project!.tasks.find((candidate) => candidate.id === id)!;
      return { ...canonicalPosition(target, index), ...PROJECT_TASK_CARD_SIZE };
    }), PROJECT_TASK_CARD_SIZE);
    await projectWrite((current) => productivityMoveTaskSameLevel({ expectedDataDir, project: ref(current), taskId: task.id, targetParentTaskId: selected, expectedSourceSiblingIds: sourceIds, expectedTargetSiblingIds: targetIds, targetOrderedSiblingIds: [...targetIds, task.id], position }));
  }

  function chooseFromDialog(title: string, options: { value: string; label: string }[]): Promise<string | null> {
    return new Promise((resolve) => {
      const dialog = createInsightDialog({ title, bodyHtml: `<div data-choice></div>`, submitLabel: "选择", cancelLabel: "取消", panelClass: "project-page-v2__dialog" });
      const host = dialog.body.querySelector<HTMLElement>("[data-choice]")!;
      let selected: string | null = options[0]?.value ?? null;
      const select = mountSelectField(host, { label: title, options, search: true, multiple: false, value: selected, onChange: (value) => { selected = value; } });
      dialog.bindChrome(() => { select.dispose(); void dialog.close().then(() => { dialog.dispose(); resolve(null); }); });
      dialog.panel.addEventListener("submit", (event) => { event.preventDefault(); select.dispose(); void dialog.close().then(() => { dialog.dispose(); resolve(selected); }); });
      void dialog.open();
    });
  }

  async function deleteTask(task: TaskSnapshot): Promise<void> {
    if (!live() || !project || deleted) return;
    const origin = project;
    const descendants = descendantsOf(origin, task.id);
    const subtreeIds = [task.id, ...descendants.map((candidate) => candidate.id)];
    const edges = (project.taskSequenceEdges ?? []).filter((edge) => !edge.deletedAtUtc && (subtreeIds.includes(edge.sourceTaskId) || subtreeIds.includes(edge.targetTaskId)));
    const taskLines = [task, ...descendants].map((entry) => `• ${entry.title} [${entry.id}]`).join("\n");
    const edgeLines = edges.map((edge) => `• ${edge.id}: ${edge.sourceTaskId} → ${edge.targetTaskId}`).join("\n");
    const confirmed = await getConfirmDialog()("删除任务子树", `将软删除以下任务及 ${edges.length} 条顺序关系。关联安排、检查点与历史记录会保留。\n\n${taskLines}\n\n${edgeLines || "没有顺序关系"}`, undefined, { confirmLabel: "删除任务", danger: true });
    if (!confirmed || !live() || project?.id !== origin.id) return;
    // Confirmation covers this exact subtree and revision, never a newer root (docs/specs/0012-project-task-mvp.proposed.md).
    await projectWrite(() => productivityDeleteTaskSubtreeMvp({ expectedDataDir, project: ref(origin), taskId: task.id, expectedSubtreeTaskIds: subtreeIds, expectedEdgeIds: edges.map((edge) => edge.id) }));
  }

  async function showDeletedBatches(): Promise<void> {
    if (!projectId) return;
    const requestedProjectId = projectId;
    const requestedGeneration = generation;
    try {
      const response = await productivityListDeletedTaskBatches({ expectedDataDir, projectId: requestedProjectId });
      if (!live() || !project || response.projectId !== requestedProjectId || projectId !== requestedProjectId || generation !== requestedGeneration) return;
      const content = response.batches.length ? response.batches.map((batch) => `<article class="project-page-v2__deleted-batch"><div><strong>${escapeHtml(batch.rootTitle)}</strong><p>${batch.taskIds.length} 项任务 · ${batch.edgeIds.length} 条关系 · ${escapeHtml(batch.deletedAtUtc)}</p><details><summary>核对恢复范围</summary><p>任务：${batch.taskIds.map(escapeHtml).join("、") || "无"}</p><p>关系：${batch.edgeIds.map(escapeHtml).join("、") || "无"}</p></details></div><button type="button" data-restore="${escapeHtml(batch.rootTaskId)}" data-batch="${escapeHtml(batch.deletionBatchId)}">恢复此范围</button></article>`).join("") : `<p>没有已删除任务。</p>`;
      const dialog = createInsightDialog({ title: "已删除任务", bodyHtml: `<div class="project-page-v2__deleted-list">${content}</div>`, submitLabel: "完成", cancelLabel: "关闭", panelClass: "project-page-v2__dialog" });
      mountProjectButtons(dialog.body);
      dialog.bindChrome(() => { void dialog.close().then(() => dialog.dispose()); });
      dialog.body.querySelectorAll<HTMLButtonElement>("[data-restore]").forEach((button) => button.addEventListener("click", () => {
        const batch = response.batches.find((entry) => entry.rootTaskId === button.dataset.restore && entry.deletionBatchId === button.dataset.batch);
        if (!batch || !project) return;
        const restoreRequest = deletedBatchRestoreRequest(expectedDataDir, response, batch);
        const confirmed = getConfirmDialog()("核对并恢复删除批次", `将恢复 ${restoreRequest.expectedSubtreeTaskIds.length} 项任务和 ${restoreRequest.expectedEdgeIds.length} 条关系。\n\n任务 ID：${restoreRequest.expectedSubtreeTaskIds.join("、") || "无"}\n关系 ID：${restoreRequest.expectedEdgeIds.join("、") || "无"}`, undefined, { confirmLabel: "恢复此批次" });
        void Promise.resolve(confirmed).then((accepted) => {
          if (!accepted || !project || !live() || projectId !== requestedProjectId || generation !== requestedGeneration) return;
        void projectWrite(() => productivityRestoreTaskSubtreeBatch(restoreRequest)).then((result) => {
          if (!result) return;
          const skipped = result.restoreSummary?.skippedEdges ?? [];
          if (skipped.length) setError(`已恢复任务；${skipped.length} 条关系未恢复：${skipped.map((edge) => `${edge.edgeId}（${edge.reasonCode}）`).join("、")}`);
          void dialog.close().then(() => dialog.dispose());
        });
        });
      }));
      dialog.panel.addEventListener("submit", (event) => { event.preventDefault(); void dialog.close().then(() => dialog.dispose()); });
      void dialog.open();
    } catch (error) { setError(`读取已删除任务失败：${errorMessage(error)}`); }
  }

  async function lifecycle(task: TaskSnapshot, outcome: "complete" | "cancel", disposition: "preserve" | "end"): Promise<void> {
    if (!project) return;
    const requestedProjectId = projectId;
    const requestedGeneration = generation;
    const scope = [task, ...descendantsOf(project, task.id)];
    if (outcome === "cancel") {
      const confirmed = await getConfirmDialog()("取消任务", `只取消当前任务“${task.title}”。后代任务、安排与历史记录不会被修改。`, undefined, { confirmLabel: "取消任务", danger: true });
      if (!confirmed || !project || projectId !== requestedProjectId || generation !== requestedGeneration) return;
      await projectWrite((current) => productivitySetTaskStatusGuarded({ expectedDataDir, project: ref(current), taskId: task.id, status: "取消" }));
      return;
    }
    let actionsResponse: ActionsListResponse;
    let checkpointsResponse: CheckpointsListResponse;
    try {
      [actionsResponse, checkpointsResponse] = await Promise.all([
        productivityListActions(expectedDataDir),
        productivityListCheckpoints({ includeDeleted: false, expectedDataDir }),
      ]);
    } catch (error) {
      if (live() && projectId === requestedProjectId && generation === requestedGeneration) setError(`无法读取安排或检查点，未更改任务：${errorMessage(error)}`);
      return;
    }
    if (!live() || !project || projectId !== requestedProjectId || generation !== requestedGeneration) return;
    const taskIds = new Set(scope.map((candidate) => candidate.id));
    const relatedActions = actionsResponse.actions.filter((action) => !action.deletedAtUtc && action.targetKind === "task" && !!action.targetId && taskIds.has(action.targetId) && !action.ended);
    const ownPending = checkpointsResponse.checkpoints.filter((checkpoint) => !checkpoint.deletedAtUtc && !checkpoint.completed && checkpoint.targetKind === "task" && checkpoint.targetId === task.id);
    const refs = relatedActions.map((action) => ref(action));
    const checkpointRefs = ownPending.map((checkpoint) => ({ id: checkpoint.id, expectedRevision: checkpoint.revision }));
    if (outcome === "complete" && disposition === "preserve" && relatedActions.some((action) => action.executionState === "进行中" || action.executionState === "暂停")) {
      setError("不能普通完成：自身或后代有已开始且未结束的安排。可查看并结束安排，或稍后再试。"); return;
    }
    const actionLines = relatedActions.map((action) => {
      const now = Date.now();
      const hasActiveInterval = action.intervals.some((interval) => !interval.endedAt);
      const duration = action.intervals.reduce((sum, interval) => sum + Math.max(0, Date.parse(interval.endedAt ?? new Date(now).toISOString()) - Date.parse(interval.startedAt)), 0);
      return `• ${action.title} [${action.id}@${action.revision}]（${action.executionState}${duration ? `，${hasActiveInterval ? "含进行中" : "已记录"}${Math.round(duration / 60000)} 分钟` : ""}）`;
    }).join("\n");
    const checkpointLines = ownPending.map((checkpoint) => `• ${checkpoint.title} [${checkpoint.id}@${checkpoint.revision}]`).join("\n");
    const isExplicit = disposition === "end";
    const message = `${isExplicit ? `完成“${task.title}”并结束相关未结束安排：` : `完成“${task.title}”，保留未开始安排：`}\n${actionLines || "• 没有未结束安排"}${ownPending.length ? `\n\n完成当前任务自身的待完成检查点（不记录实际时间）：\n${checkpointLines}` : ""}`;
    const confirmed = await getConfirmDialog()(isExplicit ? "完成并结束相关安排" : "完成任务", message, undefined, { confirmLabel: isExplicit ? "完成并结束" : "完成" });
    if (!confirmed || !project || projectId !== requestedProjectId || generation !== requestedGeneration) return;
    const targetProjectId = requestedProjectId;
    const targetGeneration = requestedGeneration;
    const run = async (): Promise<void> => {
      if (!live() || !project || project.id !== targetProjectId) return;
      writeCount += 1; syncDirty();
      try {
        const response = await productivityCommitThingLifecycle({
          thingKind: "task", owningRoot: ref(project), taskId: task.id, outcome: "complete",
          expectedMembers: refs, expectedCheckpoints: checkpointRefs, expectedDataDir,
          confirmActiveIntervals: isExplicit,
          completeCheckpointsWithoutActual: ownPending.length > 0,
          actionDisposition: disposition,
        });
        if (!live() || generation !== targetGeneration || projectId !== targetProjectId) return;
        if (response.project) applyCanonical(response.project);
        else await refreshCanonical(true);
        setError("");
      } catch (error) {
        if (live() && generation === targetGeneration && projectId === targetProjectId) {
          if (isRevisionConflict(error)) {
            setError("项目已在别处变化，最新内容已刷新；请核对后再操作。");
            await refreshCanonical(true, false);
          } else setError(errorMessage(error));
        }
      } finally { writeCount = Math.max(0, writeCount - 1); syncDirty(); }
    };
    const queued = writeQueue.then(run, run);
    writeQueue = queued.then(() => undefined, () => undefined);
    await queued;
  }

  function applyPendingFocus(): void {
    const request = pendingFocus;
    pendingFocus = null;
    if (!isCurrentProjectFocusRequest(request, projectId, generation) || !project) return;
    const task = project.tasks.find((candidate) => candidate.id === request.taskId);
    if (!task || task.deletedAtUtc) { setError("请求定位的任务已删除或不存在，请从项目任务列表中查找。"); return; }
    const lineage: TaskSnapshot[] = [task];
    let parentId = task.parentTaskId ?? null;
    while (parentId) {
      const parent = project.tasks.find((candidate) => candidate.id === parentId && !candidate.deletedAtUtc);
      if (!parent) break;
      lineage.unshift(parent); parentId = parent.parentTaskId ?? null;
    }
    selectedRootTaskId = lineage[0]?.id ?? null;
    if (lineage.length >= 2) {
      selectedMapTaskId = lineage[1]!.id;
      selectedMapTaskIds.clear(); selectedMapTaskIds.add(lineage[1]!.id);
      expandedTaskIds.clear(); expandedTaskIds.add(lineage[1]!.id);
      taskSidebar?.select(lineage[2]?.id ?? lineage[1]!.id);
      if (lineage.length > 3) setError("任务已定位到当前只读的第四层及更深数据；可在路径图中查看其上级任务。");
    } else setError("任务已定位在第一层。");
    renderPage();
  }

  taskSidebar = mountProjectTaskDetail({
    host: page.taskSidebar, getProject: () => project, getDataDir: () => expectedDataDir, isLive: live,
    onProjectChange: (next) => { if (!project || next.revision >= project.revision) applyCanonical(next); },
    onError: setError, onDirty: syncDirty,
    onNavigate: (sidebar) => { requestProjectNavigation({ sidebar }); },
    lifecycle: async (id, outcome) => {
      const task = project?.tasks.find((value) => value.id === id && !value.deletedAtUtc);
      if (task) await lifecycle(task, outcome, "preserve");
    },
    runWrite: <T>(job: () => Promise<T>): Promise<T> => {
      const originalId = projectId;
      const run = async () => {
        if (!live() || !project || project.id !== originalId || deleted) throw new Error("项目已不可用");
        writeCount += 1; syncDirty();
        try { return await job(); }
        finally { writeCount = Math.max(0, writeCount - 1); syncDirty(); }
      };
      const queued = writeQueue.then(run, run);
      writeQueue = queued.then(() => undefined, () => undefined);
      return queued;
    },
  });
  taskSidebar.render();
  const mapResizeObserver = new ResizeObserver(() => scheduleMapRender());
  mapResizeObserver.observe(page.mapViewport);
  const unsubscribeTaskGlow = subscribeCategoryAppearance(() => scheduleMapRender());
  const mapEvents = new AbortController();
  window.addEventListener("pointerdown", (event) => {
    const pin = event.target instanceof Element ? event.target.closest("[data-link-pin]") : null;
    if (pin && page.mapControls.contains(pin)) onMapPointerDown(event);
  }, { capture: true, signal: mapEvents.signal });
  window.addEventListener("pointermove", (event) => {
    if (linkDrag?.pointerId !== event.pointerId) return;
    event.preventDefault(); event.stopPropagation();
    if (!(event.buttons & 1)) { cancelLinkDrag(); return; }
    onMapPointerMove(event);
  }, { capture: true, passive: false, signal: mapEvents.signal });
  const finishWindowLink = (event: PointerEvent) => {
    if (linkDrag?.pointerId !== event.pointerId) return;
    event.preventDefault(); event.stopPropagation();
    suppressLinkClick = event.type === "pointerup";
    window.setTimeout(() => { suppressLinkClick = false; }, 0);
    onMapPointerUp(event);
  };
  window.addEventListener("pointerup", finishWindowLink, { capture: true, signal: mapEvents.signal });
  window.addEventListener("pointercancel", finishWindowLink, { capture: true, signal: mapEvents.signal });
  window.addEventListener("click", (event) => {
    if (!suppressLinkClick) return;
    suppressLinkClick = false;
    event.preventDefault(); event.stopImmediatePropagation();
  }, { capture: true, signal: mapEvents.signal });
  page.mapViewport.addEventListener("contextmenu", (event) => {
    if (!linkDrag) return;
    event.preventDefault(); event.stopImmediatePropagation(); cancelLinkDrag();
  }, { capture: true, signal: mapEvents.signal });
  const cancelOnBlur = () => {
    spaceDown = false;
    cancelLinkDrag();
    clearHoverPin(true);
    if (anchorDrag) cancelAnchorDrag();
    if (drag || marquee || pan) cancelMapGesture();
  };
  window.addEventListener("blur", cancelOnBlur, { signal: mapEvents.signal });
  document.addEventListener("visibilitychange", () => { if (document.hidden) cancelOnBlur(); }, { signal: mapEvents.signal });
  for (const name of ["focusin", "focusout", "input"]) page.mapCards.addEventListener(name, () => queueMicrotask(syncDirty));

  page.firstCreateInput.addEventListener("input", syncDirty, { signal: mapEvents.signal });
  page.firstCreateForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const title = page.firstCreateInput.value.trim();
    if (!title || !project) return;
    void projectWrite((current) => productivityCreateTaskInProject({ expectedDataDir, project: ref(current), title, status: "未做", parentTaskId: null })).then((result) => { if (result) { if (page.firstCreateInput.value.trim() === title) page.firstCreateInput.value = ""; syncDirty(); } });
  });
  page.mapViewport.addEventListener("contextmenu", (event) => {
    if (linkDrag) { event.preventDefault(); cancelLinkDrag(); return; }
    clearHoverPin();
    if ((event.target as Element).closest("[data-task-id], [data-edge-id], [data-edge-handle]")) return;
    event.preventDefault();
    if (expandedTaskIds.size) return;
    if (!live() || !project || deleted) return;
    const originalProjectId = project.id;
    const originalParentId = selectedRootTaskId;
    const point = mapScreenPoint(page, camera, event.clientX, event.clientY);
    edgeContextMenu?.dispose();
    edgeContextMenu = showCommandMenuAt(event.clientX, event.clientY, [
      { value: "add", label: "添加任务", disabled: !originalParentId },
      { value: "fit", label: "适应画布" },
    ], (value) => {
      if (!live() || project?.id !== originalProjectId || selectedRootTaskId !== originalParentId) return;
      if (value === "add" && originalParentId) openCreateTask(originalParentId, findOpenCardPosition(point, mapNodes().map(({ position }) => ({ ...position, ...PROJECT_TASK_CARD_SIZE })), PROJECT_TASK_CARD_SIZE));
      else if (value === "fit") fitMap();
    }, { onClose: () => { edgeContextMenu = null; } });
  });
  page.mapViewport.addEventListener("pointerdown", onMapPointerDown);
  page.mapViewport.addEventListener("pointermove", onMapPointerMove);
  page.mapViewport.addEventListener("pointerleave", () => {
    if (!linkDrag) clearHoverPin();
    if (drag && !drag.moved) drag = null;
  });
  page.mapViewport.addEventListener("pointerup", onMapPointerUp);
  page.mapViewport.addEventListener("pointercancel", onMapPointerUp);
  page.mapViewport.addEventListener("lostpointercapture", (event) => {
    if (event.target !== page.mapViewport) return;
    if (anchorDrag?.pointerId === event.pointerId) cancelAnchorDrag();
    else if (drag?.pointerId === event.pointerId || marquee?.pointerId === event.pointerId || pan?.pointerId === event.pointerId) cancelMapGesture();
  });
  page.mapViewport.addEventListener("wheel", onMapWheel, { passive: false });
  page.mapCards.addEventListener("click", (event) => {
    if (suppressMapClick || !project) return;
    const child = (event.target as Element).closest<HTMLElement>("[data-child-task-id]");
    if (child?.dataset.childTaskId) { selectMapTask(child.dataset.childTaskId, false); return; }
    const card = (event.target as HTMLElement).closest<HTMLElement>("[data-task-id]");
    if (!card?.dataset.taskId) return;
    if (!expandedTaskIds.size && (event.shiftKey || event.ctrlKey || event.metaKey)) {
      toggleMapSelection(card.dataset.taskId); return;
    }
    if (!expandedTaskIds.size && selectedMapTaskIds.size > 1 && selectedMapTaskIds.has(card.dataset.taskId)) {
      selectMapTask(card.dataset.taskId, false, true); return;
    }
    if (!(event.target as Element).closest("[data-card-children]")) selectMapTask(card.dataset.taskId, true);
  });
  page.mapCards.addEventListener("contextmenu", (event) => {
    const child = (event.target as Element).closest<HTMLElement>("[data-child-task-id]");
    if (child?.dataset.childTaskId) {
      const task = project?.tasks.find((candidate) => candidate.id === child.dataset.childTaskId && !candidate.deletedAtUtc);
      if (task) taskContextMenu(event, task);
      return;
    }
    if ((event.target as Element).closest("[data-card-children]")) { event.preventDefault(); return; }
    const card = (event.target as HTMLElement).closest<HTMLElement>("[data-task-id]");
    const task = project?.tasks.find((candidate) => candidate.id === card?.dataset.taskId);
    if (task) relationMenu(event, task);
  });
  page.mapEdges.addEventListener("contextmenu", (event) => {
    const path = (event.target as SVGElement).closest<SVGPathElement>("[data-edge-id]");
    if (!path?.dataset.edgeId) return;
    event.preventDefault();
    selectedEdgeId = path.dataset.edgeId;
    const edgeId = selectedEdgeId;
    selectedMapTaskId = null; selectedMapTaskIds.clear(); renderMap();
    edgeContextMenu?.dispose();
    edgeContextMenu = showCommandMenuAt(event.clientX, event.clientY, [
      { value: "remove", label: "删除顺序线", danger: true },
      { value: "source", label: "起点恢复自动连接" },
      { value: "target", label: "终点恢复自动连接" },
    ], (value) => {
      if (value === "remove") void removeSequence(edgeId);
      else if (value === "source" || value === "target") {
        if (anchorDraft?.failed) { showAnchorFailure(); return; }
        const request = makeAnchorRequest(edgeId, value, null);
        if (request) void saveAnchor(request);
      }
    }, { onClose: () => { edgeContextMenu = null; } });
  });
  page.mapEdges.addEventListener("click", (event) => {
    const path = (event.target as SVGElement).closest<SVGPathElement>("[data-edge-id]");
    if (!path?.dataset.edgeId || suppressMapClick) return;
    selectedEdgeId = path.dataset.edgeId; selectedMapTaskId = null; selectedMapTaskIds.clear();
    renderMap(); page.mapViewport.focus({ preventScroll: true });
  });
  page.mapViewport.addEventListener("click", (event) => {
    if (suppressMapClick || (event.target as Element).closest("[data-edge-id], [data-task-id], [data-edge-handle]")) return;
    if (!(event.shiftKey || event.ctrlKey || event.metaKey)) selectedMapTaskIds.clear();
    expandedTaskIds.clear(); selectedEdgeId = null; renderMap();
  });
  page.mapViewport.addEventListener("keydown", (event) => {
    if (event.key === "Escape") clearHoverPin();
    if (event.key === "Escape" && linkDrag) { event.preventDefault(); event.stopPropagation(); cancelLinkDrag(); return; }
    if (linkDrag) return;
    if (event.key === "Escape" && anchorDrag) { event.preventDefault(); cancelAnchorDrag(); return; }
    if (event.key === "Escape" && (drag || marquee || pan)) { event.preventDefault(); event.stopPropagation(); cancelMapGesture(); return; }
    if ((event.key === "Delete" || event.key === "Backspace") && selectedEdgeId && !(event.target as Element).closest("input, textarea, select, [contenteditable]")) {
      event.preventDefault(); void removeSequence(selectedEdgeId);
    }
  });
  page.mapControls.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    const handle = (event.target as Element).closest<SVGCircleElement>("[data-edge-handle]");
    if (!handle || !selectedEdgeId) return;
    event.preventDefault(); event.stopPropagation();
    if (anchorSaving || anchorDraft?.failed || anchorDrag) return;
    const endpoint = handle.dataset.edgeHandle;
    if (endpoint !== "source" && endpoint !== "target") return;
    const edge = mapEdgeInputs().find((value) => value.id === selectedEdgeId);
    const nodes = mapNodes();
    const source = nodes.find((value) => value.task.id === edge?.sourceTaskId);
    const target = nodes.find((value) => value.task.id === edge?.targetTaskId);
    if (!edge || !source || !target) return;
    const from = { ...source.position, ...PROJECT_TASK_CARD_SIZE };
    const to = { ...target.position, ...PROJECT_TASK_CARD_SIZE };
    const bounds = endpoint === "source" ? from : to;
    const curve = edgeCurve(from, to, edge.sourceAnchor, edge.targetAnchor);
    const current = endpoint === "source" ? curve.start : curve.end;
    const anchors = cardAnchors(bounds);
    const distance = (index: number) => {
      const point = anchorPoint(bounds, anchors[index]!);
      return Math.hypot(point.x - current.x, point.y - current.y);
    };
    const index = anchors.reduce((best, _anchor, index) => distance(index) < distance(best) ? index : best, 0);
    const delta = event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1;
    const next = anchors[(Math.max(0, index) + delta + anchors.length) % anchors.length]!;
    const request = makeAnchorRequest(edge.id, endpoint, next);
    if (request) {
      page.mapViewport.focus({ preventScroll: true });
      const requestFocusEpoch = focusEpoch;
      void saveAnchor(request).then(() => {
        if (live() && requestFocusEpoch === focusEpoch && selectedEdgeId === edge.id && document.activeElement === page.mapViewport) {
          page.mapControls.querySelector<SVGCircleElement>(`[data-edge-handle="${endpoint}"]`)?.focus();
        }
      });
    }
  });
  page.mapCards.addEventListener("keydown", (event) => {
    if ((event.target as Element).closest("[data-card-title], [data-card-children], input, textarea")) return;
    if (event.key === "Enter" || event.key === " ") {
      const card = (event.target as HTMLElement).closest<HTMLElement>("[data-task-id]");
      if (card?.dataset.taskId) { event.preventDefault(); event.stopPropagation(); selectMapTask(card.dataset.taskId, true); }
      return;
    }
    if (!(event instanceof KeyboardEvent) || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    if (expandedTaskIds.size) return;
    const card = (event.target as HTMLElement).closest<HTMLElement>("[data-task-id]");
    const task = project?.tasks.find((candidate) => candidate.id === card?.dataset.taskId);
    if (!task) return;
    event.preventDefault();
    const nodes = mapNodes(); const index = nodes.findIndex((node) => node.task.id === task.id);
    const current = nodes[index]?.position ?? { x: 0, y: 0 };
    const delta = event.shiftKey ? TASK_GRID_SIZE * 4 : TASK_GRID_SIZE;
    const next = { x: current.x + (event.key === "ArrowLeft" ? -delta : event.key === "ArrowRight" ? delta : 0), y: current.y + (event.key === "ArrowUp" ? -delta : event.key === "ArrowDown" ? delta : 0) };
    previewPositions.set(task.id, snapPoint(next));
    renderMap();
    savePosition(task, previewPositions.get(task.id)!);
  });
  page.root.addEventListener("keydown", (event) => {
    if ((event.target as Element).closest("input, textarea, [contenteditable]")) return;
    if (event.key === "Escape") {
      if (expandedTaskIds.size) {
        event.preventDefault(); event.stopPropagation();
        if (requestProjectNavigation({ expandedTaskIds: [] }, true)) return;
        const id = [...expandedTaskIds][0];
        const focusCard = page.mapViewport.contains(document.activeElement);
        expandedTaskIds.clear(); renderMap();
        if (focusCard) [...page.mapCards.querySelectorAll<HTMLElement>("[data-task-id]")].find((card) => card.dataset.taskId === id)?.focus({ preventScroll: true });
      }
    }
    if (event.code === "Space") spaceDown = true;
  });
  page.root.addEventListener("keyup", (event) => { if (event.code === "Space") spaceDown = false; });
  required<HTMLButtonElement>(page.firstLayer, '[data-project-action="deleted"]').addEventListener("click", () => { void showDeletedBatches(); });
  const firstCreateToggle = required<HTMLButtonElement>(page.firstLayer, "[data-first-create-toggle]");
  firstCreateToggle.addEventListener("click", () => {
    page.firstCreateForm.hidden = !page.firstCreateForm.hidden;
    firstCreateToggle.setAttribute("aria-expanded", String(!page.firstCreateForm.hidden));
    if (!page.firstCreateForm.hidden) page.firstCreateInput.focus();
  });

  const onProjectQueryBlockers = (event: Event) => {
    const detail = (event as CustomEvent<{ dataDir: string; projectId: string; blocked: boolean }>).detail;
    if (live() && detail?.dataDir === expectedDataDir && detail.projectId === projectId && navigationDraftBlocked()) detail.blocked = true;
  };
  window.addEventListener("orbita-project-query-blockers", onProjectQueryBlockers);
  const onProjectDeleted = (event: Event) => {
    const detail = (event as CustomEvent<{ dataDir: string; project: ProjectSnapshot }>).detail;
    if (!live() || !detail || detail.dataDir !== expectedDataDir || detail.project.id !== projectId || !detail.project.deletedAtUtc) return;
    deleted = true;
    project = detail.project;
    canonicalReadError = null;
    cancelLinkDrag();
    cancelMapGesture();
    page.firstLayer.hidden = true;
    page.mapLayer.hidden = true;
    page.taskSidebar.inert = true;
    page.loading.hidden = false;
    page.loading.textContent = "此项目已删除，页面只读。";
    if (detailDialog) {
      detailDialog.body.inert = true;
      detailDialog.setError("此项目已删除；未保存的内容仍保留在当前窗口。");
    }
  };
  window.addEventListener("orbita-project-deleted", onProjectDeleted);

  const handle: InsightDestinationHandle = {
    navigation: {
      capture: captureProjectNavigation,
      onVisible: () => { if (detailDialog) detailDialog.backdrop.hidden = false; },
      restoreContext(value, token) {
        if (!token.isCurrent()) return;
        const position = value as { camera?: Camera; firstTop?: number; detailTop?: number; sidebarTop?: number } | null;
        if (position?.camera && [position.camera.x, position.camera.y, position.camera.zoom].every(Number.isFinite)) {
          camera = { ...position.camera };
          page.mapCanvas.style.transform = `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})`;
        }
        page.firstTaskList.scrollTop = position?.firstTop ?? page.firstTaskList.scrollTop;
        page.taskSidebar.scrollTop = position?.sidebarTop ?? page.taskSidebar.scrollTop;
        if (detailDialog) detailDialog.panel.scrollTop = position?.detailTop ?? detailDialog.panel.scrollTop;
      },
      canNavigate(intent) {
        if (intent.intent === "preserve-instance") return true;
        if (navigationDraftBlocked()) { setError("请先完成或放弃当前项目的未保存修改。"); return false; }
        return true;
      },
      async restore(state, token) {
        const route = state.route as ProjectNavigationRoute | null;
        if (!route || route.projectId !== projectId || !Array.isArray(route.expandedTaskIds) || !route.sidebar) return { status: "unavailable", message: "项目页面状态已失效" };
        if (!projectId || deleted) return { status: "unavailable", message: "项目不可用" };
        // Prepare current canonical data before changing visible route; no replay of business writes (SPEC-0014 §4.3).
        let next: ProjectSnapshot;
        try { next = (await productivityGetProject({ id: projectId, expectedDataDir })).project; }
        catch (error) { return { status: "failed", error }; }
        if (!token.isCurrent() || !live() || deleted) return { status: "blocked" };
        const taskIds = [route.rootTaskId, route.mapTaskId, route.detailTaskId, route.sidebar.taskId, ...route.expandedTaskIds].filter((id): id is string => !!id);
        if (!next.deletedAtUtc && taskIds.some((id) => !next.tasks.some((task) => task.id === id && !task.deletedAtUtc))) return { status: "unavailable", message: "原详情已不可用" };
        // Sidebar preparation uses the same project identity and current revision.
        const previousProject = project;
        project = next;
        try {
          if (taskSidebar && !(await taskSidebar.prepareNavigation(next, route.sidebar))) { if (!deleted) project = previousProject; return { status: "unavailable", message: "原详情已不可用" }; }
        } catch (error) { if (!deleted) project = previousProject; return { status: "failed", error }; }
        if (!token.isCurrent() || !live() || deleted) { if (!deleted) project = previousProject; return { status: "blocked" }; }
        applyingNavigation = true;
        try {
          if (detailDialog && route.detailTaskId !== detailParentId) {
            const closing = requestCloseDetail();
            applyingNavigation = false;
            await closing;
            applyingNavigation = true;
          }
          if (!token.isCurrent() || deleted) return { status: "blocked" };
          applyCanonical(next, false);
          selectedRootTaskId = route.rootTaskId; selectedMapTaskId = route.mapTaskId; selectedEdgeId = null;
          expandedTaskIds.clear(); route.expandedTaskIds.forEach((id) => expandedTaskIds.add(id));
          taskSidebar?.restoreNavigation(route.sidebar);
          renderPage();
          if (route.detailTaskId && !detailDialog) { const task = next.tasks.find((task) => task.id === route.detailTaskId); if (task) openTaskDetail(task, route.detailFocusTaskId); }
          else if (route.detailTaskId && detailDialog) { detailFocusTaskId = route.detailFocusTaskId; renderOpenDetailRows?.(); }
          const position = state.context as { camera?: Camera; firstTop?: number; detailTop?: number; sidebarTop?: number } | null;
          if (position?.camera && [position.camera.x, position.camera.y, position.camera.zoom].every(Number.isFinite)) camera = { ...position.camera };
          renderMap();
          applyingNavigation = false;
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
          if (!token.isCurrent()) return { status: "blocked" };
          page.firstTaskList.scrollTop = position?.firstTop ?? 0; page.taskSidebar.scrollTop = position?.sidebarTop ?? 0;
          if (detailDialog) detailDialog.panel.scrollTop = position?.detailTop ?? 0;
          return { status: "applied" };
        } finally { applyingNavigation = false; }
      },
    },
    async activate() { focusEpoch += 1; if (projectId && !deleted) { rail.setSelectedProject(projectId); await refreshCanonical(); if (canonicalReadError) throw canonicalReadError; } },
    deactivate() {
      if (detailDialog) detailDialog.backdrop.hidden = true;
      focusEpoch += 1;
      cancelLinkDrag();
      clearHoverPin(true);
      cancelMapGesture();
      if (anchorDrag) cancelAnchorDrag();
      edgeContextMenu?.dispose(); edgeContextMenu = null;
    },
    getSecondaryRailDescriptor: () => rail.getSecondaryRailDescriptor(page.firstLayer, () => {
      focusEpoch += 1;
      edgeContextMenu?.dispose(); edgeContextMenu = null;
    }),
    getRestoreState: () => projectId ? { projectId } : undefined,
    restoreState(state: unknown) { cancelLinkDrag(); pendingFocus = null; projectId = (state as { projectId?: string } | null)?.projectId ?? null; if (projectId) rail.setSelectedProject(projectId); },
    handlePageRequest(request) {
      if (disposed || !isCurrentProjectFocusRequest(request, projectId, generation)) return;
      pendingFocus = request;
      if (project) applyPendingFocus(); else void refreshCanonical();
    },
    canDispose() {
      if (detailSaving || writeCount > 0 || anchorSaving || linkSaving || taskSidebar?.hasPendingWrites()) return false;
      const blocked = Boolean(detailDirty || detailFailed || detailSaving || writeCount > 0 || failedPositions.size > 0 || previewPositions.size > 0 || anchorDrag || anchorDraft || anchorSaving || linkDrag || linkDraft || linkSaving || failedTitles.size || taskSidebar?.isDirty() || page.firstCreateInput.value.trim() || page.mapCards.querySelector("input, textarea"));
      if (deleted && blocked) return getConfirmDialog()("关闭已删除的项目", "此页面仍有未保存的内容。关闭会放弃这些内容，确定关闭吗？", undefined, { confirmLabel: "放弃并关闭", danger: true });
      return !blocked;
    },
    dispose() {
      disposed = true;
      window.removeEventListener("orbita-project-query-blockers", onProjectQueryBlockers);
      window.removeEventListener("orbita-project-deleted", onProjectDeleted);
      cancelLinkDrag();
      unsubscribeTaskGlow();
      mapEvents.abort();
      cancelMapGesture();
      mapResizeObserver.disconnect();
      edgeContextMenu?.dispose(); edgeContextMenu = null;
      if (anchorDrag) cancelAnchorDrag();
      if (frame !== null) cancelAnimationFrame(frame);
      if (dragFrame !== null) cancelAnimationFrame(dragFrame);
      if (anchorFrame !== null) cancelAnimationFrame(anchorFrame);
      pendingFocus = null;
      if (detailDialog) { detailDialog.dispose(); detailDialog = null; }
      rowControls.forEach((control) => control.dispose());
      detailControls.forEach((control) => control.dispose());
      detailRowControls.forEach((control) => control.dispose());
      detailPickers.forEach((picker) => picker.dispose());
      detailParentSelect?.dispose();
      cardTitles.forEach(({ field }) => field.dispose()); cardTitles.clear();
      taskSidebar?.dispose(); taskSidebar = null;
      page.firstLayer.remove();
      rail.dispose();
      setDirtyStatus(surfaceKey, { dirty: false, inFlight: false, failed: false });
      root.replaceChildren();
    },
  };
  return handle;
}
