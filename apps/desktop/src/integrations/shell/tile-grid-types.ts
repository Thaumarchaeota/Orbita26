export type TileGridDragHandoff = {
  sourceId: string;
  ghost: HTMLElement;
  ghostOffsetX: number;
  ghostOffsetY: number;
  ghostHalfW: number;
  ghostHalfH: number;
  clientX: number;
  clientY: number;
  capturePointerId: number;
  external?: boolean;
  placeholderHtml?: string;
};

export type TileGridOptions<T extends { id: string; name: string }> = {
  denseItems?: boolean;
  isFolder?: (item: T) => boolean;
  onMoveToFolder?: (sourceId: string, folderId: string) => void;
  onMerge?: (sourceId: string, targetId: string) => string | void;
  onRemove?: (items: T[], id: string) => T[];
  dragOutPanel?: HTMLElement;
  onDragOutHover?: (active: boolean) => void;
  onMoveOut?: (sourceId: string) => void;
  onDragOutLeave?: (sourceId: string, handoff: TileGridDragHandoff) => boolean;
  onExternalCommit?: (sourceId: string, slot: number, absorb?: { kind: "into" | "merge"; targetId: string }) => void;
  onExternalCancel?: (sourceId: string) => void;
  onRenameFolder?: (item: T, trigger: HTMLElement) => T[] | null | Promise<T[] | null>;
};
