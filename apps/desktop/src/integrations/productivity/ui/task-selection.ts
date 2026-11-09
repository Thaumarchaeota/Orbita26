export type TaskSelectionState = {
  selected: Set<string>;
  anchorId: string | null;
};

export function createTaskSelectionState(): TaskSelectionState {
  return { selected: new Set(), anchorId: null };
}

export function updateTaskSelection(
  state: TaskSelectionState,
  visibleIds: string[],
  id: string,
  modifiers: { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean },
): void {
  const toggle = Boolean(modifiers.ctrlKey || modifiers.metaKey);
  if (modifiers.shiftKey && state.anchorId && visibleIds.includes(state.anchorId)) {
    const from = visibleIds.indexOf(state.anchorId);
    const to = visibleIds.indexOf(id);
    const start = Math.min(from, to);
    const end = Math.max(from, to);
    if (!toggle) state.selected.clear();
    for (const value of visibleIds.slice(start, end + 1)) state.selected.add(value);
  } else if (toggle) {
    if (state.selected.has(id)) state.selected.delete(id);
    else state.selected.add(id);
    state.anchorId = id;
  } else {
    state.selected.clear();
    state.selected.add(id);
    state.anchorId = id;
  }
}

export function applyTaskSelectionClasses(host: HTMLElement, state: TaskSelectionState): void {
  const rows = [...host.querySelectorAll<HTMLElement>(".task-item-row[data-item-id]")];
  rows.forEach((row, index) => {
    const selected = state.selected.has(row.dataset.itemId ?? "");
    const previousSelected = state.selected.has(rows[index - 1]?.dataset.itemId ?? "");
    const nextSelected = state.selected.has(rows[index + 1]?.dataset.itemId ?? "");
    row.classList.toggle("is-selected", selected);
    row.classList.toggle("is-selection-start", selected && !previousSelected);
    row.classList.toggle("is-selection-end", selected && !nextSelected);
  });
}

