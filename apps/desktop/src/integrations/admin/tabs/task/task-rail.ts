import { escAttr, escHtml } from "../../../../core/html";
import { buildMiniCalendarHtml } from "../../../../ui/date-picker-core";
import { shanghaiYmd } from "../../../../ui/datetime-range-display";
import { createInsightDialog } from "../../../../ui/insight-dialog";
import { mountFlatSelectPopover, type FlatSelectPopoverHandle } from "../../../../ui/flat-select-popover";
import { productivityCreateList, productivitySetListStatus, productivityUpdateList } from "../../../productivity/client";
import type { ListSnapshot } from "../../../productivity/types";
import { attachIdentityDragSource } from "../../tab-host/drag-session";
import type { RailDescriptor } from "../../secondary-rail";
import {
  activeLists,
  filterToScope,
  scopeKey,
  scopeToRestoreFilter,
  type TaskScope,
} from "./task-selectors";

const LIST_STATUSES = ["进行中", "完成", "已归档"] as const;
const UNARCHIVE_STATUSES = ["进行中", "完成"] as const;

function openCreateListDialog(): Promise<ListSnapshot | null> {
  return new Promise((resolve) => {
    const dlg = createInsightDialog({
      title: "新建清单",
      submitLabel: "创建",
      bodyHtml: `
        <label class="insight-dialog-field">
          <span class="insight-dialog-label">名称</span>
          <input type="text" name="title" required autocomplete="off" autofocus>
        </label>
        <label class="insight-dialog-field">
          <span class="insight-dialog-label">状态</span>
          <select name="status">
            ${LIST_STATUSES.map(
              (s) =>
                `<option value="${escAttr(s)}"${s === "进行中" ? " selected" : ""}>${escHtml(s)}</option>`,
            ).join("")}
          </select>
        </label>`,
    });
    const titleInput = dlg.panel.querySelector<HTMLInputElement>('[name="title"]')!;
    const titleField = titleInput.closest<HTMLElement>(".insight-dialog-field")!;
    const statusSelect = dlg.panel.querySelector<HTMLSelectElement>('[name="status"]')!;
    const setTitleFieldError = (message: string) => {
      titleField.classList.toggle("is-error", Boolean(message));
      let msg = titleField.querySelector<HTMLElement>(".insight-dialog-field-msg");
      if (message) {
        if (!msg) {
          msg = document.createElement("p");
          msg.className = "insight-dialog-field-msg";
          titleField.appendChild(msg);
        }
        msg.textContent = message;
      } else {
        msg?.remove();
      }
    };
    let settled = false;
    const finish = (list: ListSnapshot | null) => {
      if (settled) return;
      settled = true;
      void dlg.close().then(() => resolve(list));
    };
    dlg.bindChrome(() => finish(null));
    dlg.panel.addEventListener("submit", (e) => {
      e.preventDefault();
      if (dlg.busy) return;
      const title = titleInput.value.trim();
      if (!title) {
        setTitleFieldError("请输入清单名称。");
        dlg.setError("");
        titleInput.focus();
        return;
      }
      setTitleFieldError("");
      dlg.setBusy(true);
      dlg.setError("");
      void productivityCreateList({ title, status: statusSelect.value })
        .then((res) => finish(res.list))
        .catch((err) => {
          dlg.setError(`创建失败：${err instanceof Error ? err.message : String(err)}`);
          dlg.setBusy(false);
        });
    });
    void dlg.open();
  });
}

function openUnarchiveDialog(list: ListSnapshot): Promise<ListSnapshot | null> {
  return new Promise((resolve) => {
    const dlg = createInsightDialog({
      title: "取消归档",
      submitLabel: "确认",
      bodyHtml: `
        <p class="insight-dialog-hint">将「${escHtml(list.title)}」恢复为：</p>
        <label class="insight-dialog-field">
          <span class="insight-dialog-label">状态</span>
          <select name="status">
            ${UNARCHIVE_STATUSES.map((s) => `<option value="${escAttr(s)}">${escHtml(s)}</option>`).join("")}
          </select>
        </label>`,
    });
    const statusSelect = dlg.panel.querySelector<HTMLSelectElement>('[name="status"]')!;
    let settled = false;
    const finish = (next: ListSnapshot | null) => {
      if (settled) return;
      settled = true;
      void dlg.close().then(() => resolve(next));
    };
    dlg.bindChrome(() => finish(null));
    dlg.panel.addEventListener("submit", (e) => {
      e.preventDefault();
      if (dlg.busy) return;
      dlg.setBusy(true);
      dlg.setError("");
      void productivitySetListStatus({
        list: { id: list.id, expectedRevision: list.revision },
        status: statusSelect.value,
      })
        .then((res) => finish(res.list))
        .catch((err) => {
          dlg.setError(`恢复失败：${err instanceof Error ? err.message : String(err)}`);
          dlg.setBusy(false);
        });
    });
    void dlg.open();
  });
}

export type TaskRailBinding = {
  getSecondaryRailDescriptor: () => RailDescriptor;
  setScope: (scope: TaskScope) => void;
  setLists: (lists: ListSnapshot[]) => void;
  setView: (view: "week" | "list" | "categories") => void;
  setCalendar: (date: string, selected: string[], range?: { start: string; end: string } | null) => void;
  setOnItemDrop: (fn: (itemId: string, targetKey: string) => void) => void;
  dispose: () => void;
};

export type CreateTaskRailOpts = {
  onSelectScope: (scope: TaskScope) => void;
  onSelectWeek: () => void;
  onSelectCategoryManager: () => void;
  onSelectDate: (date: string, extend: boolean) => void;
  onClearDate: () => void;
  onRefresh: () => Promise<void>;
  onDeleteList: (list: ListSnapshot) => Promise<boolean>;
  onError: (message: string) => void;
};

export function createTaskRail(opts: CreateTaskRailOpts): TaskRailBinding {
  let scope: TaskScope = { kind: "all" };
  let view: "week" | "list" | "categories" = "week";
  let calendarMonth = "";
  let selectedDates: string[] = [];
  let selectedRange: { start: string; end: string } | null = null;
  let lists: ListSnapshot[] = [];
  let listHost: HTMLElement | null = null;
  let onItemDrop: ((itemId: string, targetKey: string) => void) | null = null;
  let dragItemId: string | null = null;
  let listMenu: FlatSelectPopoverHandle | null = null;
  let listMenuAnchor: HTMLElement | null = null;

  function selectedKey(): string {
    return scopeKey(scope);
  }

  function paintList(): void {
    if (!listHost) return;
    const active = activeLists(lists);
    const key = selectedKey();
    const archivedActive = key === "archived" || key.startsWith("archived:");

    const row = (selectKey: string, label: string) => {
      const active = selectKey === "week" ? view === "week" : view === "list" && (selectKey === key || (selectKey === "archived" && archivedActive));
      return `<div class="insight-chat-rail-row">
        <button type="button" class="insight-chat-rail-item${active ? " is-active" : ""}" data-select="${escAttr(selectKey)}">${escHtml(label)}</button>
      </div>`;
    };

    const month = calendarMonth || new Date().toISOString().slice(0, 7);
    const [calendarYear, calendarMonthIndex] = month.split("-").map(Number);
    const rangeStart = view === "week" ? selectedDates[0] : selectedRange?.start;
    const rangeEnd = view === "week" ? selectedDates[selectedDates.length - 1] : selectedRange?.end;
    const rangeFrom = rangeStart && rangeEnd ? (rangeStart <= rangeEnd ? rangeStart : rangeEnd) : rangeStart || rangeEnd || "";
    const rangeTo = rangeStart && rangeEnd ? (rangeStart <= rangeEnd ? rangeEnd : rangeStart) : rangeFrom;
    const miniCalendar = buildMiniCalendarHtml(calendarYear, calendarMonthIndex - 1, (value) => ({
      inRange: !!rangeFrom && value >= rangeFrom && value <= rangeTo,
    }), "orbita-date-range-cal", true, false);
    const calendar = `<section class="arrangement-calendar" aria-label="日期筛选">${miniCalendar}${view === "list" && selectedRange ? `<button type="button" class="arrangement-clear-date" data-clear-date>清除日期筛选</button>` : ""}</section>`;
    listHost.innerHTML = `
      ${calendar}
      <div class="task-rail-divider" role="separator"></div>
      ${row("all", "所有任务")}
      ${row("inbox", "Inbox")}
      ${active.map((l) => row(l.id, l.title)).join("")}
      <div class="insight-chat-rail-row"><button type="button" class="insight-chat-rail-item" data-create-list>＋ 新建清单</button></div>
      <div class="task-rail-divider" role="separator"></div>
      ${row("archived", "已归档")}
      <div class="task-rail-divider" role="separator"></div>
      <div class="insight-chat-rail-row"><button type="button" class="insight-chat-rail-item${view === "categories" ? " is-active" : ""}" data-select="categories">分类管理</button></div>`;
    const calendarCells = [...listHost.querySelectorAll<HTMLElement>(".arrangement-calendar .orbita-mini-cal-cell")];
    for (let rowStartIndex = 0; rowStartIndex < calendarCells.length; rowStartIndex += 7) {
      const row = calendarCells.slice(rowStartIndex, rowStartIndex + 7);
      const selected = row.filter((cell) => cell.classList.contains("is-in-range") || cell.classList.contains("is-active"));
      if (!selected.length) continue;
      selected[0]!.classList.add("is-range-row-start");
      selected[selected.length - 1]!.classList.add("is-range-row-end");
    }
    listHost.querySelectorAll<HTMLButtonElement>("button[data-select]").forEach((btn) => {
      if (btn.dataset.select === "week" || btn.dataset.select === "categories") return;
      if (btn.dataset.dragWired) return;
      btn.dataset.dragWired = "1";
      attachIdentityDragSource(btn, () => {
        const key = btn.dataset.select;
        if (!key) return null;
        const filter = scopeToRestoreFilter(filterToScope(key === "all" ? undefined : key));
        return {
          identity: { kind: "task-view" },
          title: "任务",
          taskFilter: filter ?? "all",
        };
      });
    });
  }

  function selectByKey(key: string): void {
    if (key === "week") { view = "week"; paintList(); opts.onSelectWeek(); return; }
    if (key === "categories") { view = "categories"; paintList(); opts.onSelectCategoryManager(); return; }
    const next = filterToScope(key === "all" ? undefined : key);
    scope = next;
    view = "list";
    paintList();
    opts.onSelectScope(next);
  }

  function onListClick(e: Event): void {
    const target = e.target as HTMLElement;
    if (target.closest("[data-create-list]")) {
      void (async () => {
        const created = await openCreateListDialog();
        if (!created) return;
        await opts.onRefresh();
        selectByKey(created.status === "已归档" ? `archived:${created.id}` : created.id);
      })();
      return;
    }
    if (target.closest("[data-clear-date]")) { opts.onClearDate(); return; }
    const yearButton = target.closest<HTMLButtonElement>(".arrangement-calendar .orbita-mini-cal-year");
    const monthButton = target.closest<HTMLButtonElement>(".arrangement-calendar .orbita-mini-cal-nav:not(.orbita-mini-cal-year)");
    if (yearButton || monthButton) {
      const [year, month] = (calendarMonth || new Date().toISOString().slice(0, 7)).split("-").map(Number);
      const delta = Number((yearButton ?? monthButton)!.dataset.dir);
      const next = yearButton
        ? new Date(Date.UTC(year + delta, month - 1, 1))
        : new Date(Date.UTC(year, month - 1 + delta, 1));
      calendarMonth = next.toISOString().slice(0, 7);
      paintList(); return;
    }
    const todayButton = target.closest<HTMLButtonElement>(".arrangement-calendar .orbita-mini-cal-month");
    if (todayButton) {
      const today = shanghaiYmd();
      calendarMonth = today.slice(0, 7);
      opts.onSelectDate(today, false);
      paintList(); return;
    }
    const dateButton = target.closest<HTMLButtonElement>(".arrangement-calendar .orbita-mini-cal-cell[data-value]");
    if (dateButton?.dataset.value) {
      calendarMonth = dateButton.dataset.value.slice(0, 7);
      opts.onSelectDate(dateButton.dataset.value, (e as MouseEvent).shiftKey);
      paintList(); return;
    }
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-select]");
    if (!btn?.dataset.select) return;
    selectByKey(btn.dataset.select);
  }

  function openRenameListDialog(list: ListSnapshot): Promise<ListSnapshot | null> {
    return new Promise((resolve) => {
      const dlg = createInsightDialog({
        title: "重命名清单",
        submitLabel: "保存",
        bodyHtml: `<label class="insight-dialog-field"><span class="insight-dialog-label">名称</span><input type="text" name="title" required autocomplete="off" value="${escAttr(list.title)}"></label>`,
      });
      const input = dlg.panel.querySelector<HTMLInputElement>('[name="title"]')!;
      let settled = false;
      const finish = (next: ListSnapshot | null) => { if (settled) return; settled = true; void dlg.close().then(() => resolve(next)); };
      dlg.bindChrome(() => finish(null));
      dlg.panel.addEventListener("submit", (event) => {
        event.preventDefault();
        if (dlg.busy) return;
        const title = input.value.trim();
        if (!title) { dlg.setError("请输入清单名称。"); input.focus(); return; }
        dlg.setBusy(true); dlg.setError("");
        void productivityUpdateList({ list: { id: list.id, expectedRevision: list.revision }, patch: { title } })
          .then((response) => finish(response.list))
          .catch((error) => { dlg.setError(`保存失败：${error instanceof Error ? error.message : String(error)}`); dlg.setBusy(false); });
      });
      void dlg.open().then(() => { input.focus(); input.select(); });
    });
  }

  function showListContextMenu(list: ListSnapshot, x: number, y: number, trigger: HTMLElement): void {
    listMenu?.dispose(); listMenuAnchor?.remove();
    const anchor = document.createElement("span");
    anchor.style.cssText = `position:fixed;left:${x}px;top:${y}px;width:1px;height:1px;opacity:0;pointer-events:none`;
    document.body.appendChild(anchor); listMenuAnchor = anchor;
    listMenu = mountFlatSelectPopover({
      anchor,
      options: [
        { value: "rename", label: "重命名" },
        { value: "archive", label: "归档" },
        { value: "delete", label: "删除清单", danger: true },
      ],
      selected: new Set(), multiple: false, search: false, menu: true,
      onOpenChange: (open) => { if (!open) { trigger.focus(); listMenuAnchor?.remove(); listMenuAnchor = null; listMenu = null; } },
      onChange: (values) => {
        const action = [...values][0];
        if (action === "rename") {
          void openRenameListDialog(list).then(async (updated) => { if (!updated) return; await opts.onRefresh(); });
        } else if (action === "archive") {
          void (async () => {
            try {
              await productivitySetListStatus({ list: { id: list.id, expectedRevision: list.revision }, status: "已归档" });
              await opts.onRefresh();
              if (selectedKey() === list.id) selectByKey("all");
            } catch (error) { opts.onError(`归档失败：${error instanceof Error ? error.message : String(error)}`); }
          })();
        } else if (action === "delete") {
          void (async () => {
            const deleted = await opts.onDeleteList(list);
            if (!deleted) return;
            await opts.onRefresh();
            if (selectedKey() === list.id) selectByKey("all");
          })();
        }
      },
    });
    void listMenu.open();
  }

  function onListContextMenu(event: Event): void {
    const mouse = event as MouseEvent;
    const target = mouse.target as HTMLElement;
    const button = target.closest<HTMLButtonElement>("button[data-select]");
    const list = button?.dataset.select ? lists.find((candidate) => candidate.id === button.dataset.select && !candidate.deletedAtUtc) : undefined;
    if (!button || !list || list.status === "已归档") return;
    mouse.preventDefault();
    showListContextMenu(list, mouse.clientX, mouse.clientY, button);
  }

  function onDragOver(e: DragEvent): void {
    if (!dragItemId) return;
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-select]");
    if (!btn?.dataset.select) return;
    const key = btn.dataset.select;
    if (key === "all" || key === "archived" || key === "categories" || key.startsWith("archived:")) return;
    e.preventDefault();
    listHost?.querySelectorAll(".is-drop-target").forEach((el) => el.classList.remove("is-drop-target"));
    btn.classList.add("is-drop-target");
  }

  function onDragLeave(): void {
    listHost?.querySelectorAll(".is-drop-target").forEach((el) => el.classList.remove("is-drop-target"));
  }

  function onDrop(e: DragEvent): void {
    e.preventDefault();
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-select]");
    listHost?.querySelectorAll(".is-drop-target").forEach((el) => el.classList.remove("is-drop-target"));
    if (!dragItemId || !btn?.dataset.select) return;
    const key = btn.dataset.select;
    if (key === "all" || key === "archived" || key === "categories" || key.startsWith("archived:")) return;
    onItemDrop?.(dragItemId, key);
    dragItemId = null;
  }

  function onDragStart(e: Event): void {
    const detail = (e as CustomEvent<{ itemId: string }>).detail;
    dragItemId = detail.itemId;
  }

  function onDragEnd(): void {
    dragItemId = null;
    listHost?.querySelectorAll(".is-drop-target").forEach((el) => el.classList.remove("is-drop-target"));
  }

  function getSecondaryRailDescriptor(): RailDescriptor {
    return {
      kind: "task",
      title: "",
      selectedKey: view === "week" ? "week" : view === "categories" ? "categories" : selectedKey(),
      onSelect: selectByKey,
      renderContent(host) {
        listHost = host;
        host.addEventListener("click", onListClick);
        host.addEventListener("contextmenu", onListContextMenu);
        host.addEventListener("dragover", onDragOver);
        host.addEventListener("dragleave", onDragLeave);
        host.addEventListener("drop", onDrop);
        window.addEventListener("task-item-drag-start", onDragStart);
        window.addEventListener("task-item-drag-end", onDragEnd);
        paintList();
        return () => {
          host.removeEventListener("click", onListClick);
          host.removeEventListener("contextmenu", onListContextMenu);
          host.removeEventListener("dragover", onDragOver);
          host.removeEventListener("dragleave", onDragLeave);
          host.removeEventListener("drop", onDrop);
          window.removeEventListener("task-item-drag-start", onDragStart);
          window.removeEventListener("task-item-drag-end", onDragEnd);
          host.innerHTML = "";
          listHost = null;
        };
      },
    };
  }

  return {
    getSecondaryRailDescriptor,
    setScope(next) {
      scope = next;
      paintList();
    },
    setLists(next) {
      lists = next;
      paintList();
    },
    setView(next) { view = next; paintList(); },
    setCalendar(date, selected, range) { calendarMonth = date.slice(0, 7); selectedDates = selected; selectedRange = range ?? null; paintList(); },
    setOnItemDrop(fn) {
      onItemDrop = fn;
    },
    dispose() {
      listMenu?.dispose(); listMenuAnchor?.remove(); listMenu = null; listMenuAnchor = null;
      listHost = null;
    },
  };
}

export async function unarchiveList(
  list: ListSnapshot,
  _onError: (message: string) => void,
): Promise<ListSnapshot | null> {
  return openUnarchiveDialog(list);
}
