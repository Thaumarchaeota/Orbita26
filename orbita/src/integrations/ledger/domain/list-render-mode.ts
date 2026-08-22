import { LIST_FULL_MAX_COUNT } from "../constants";

export type ListRenderMode = "full" | "virtual";

export function resolveListRenderMode(
  count: number,
  _currentMode: ListRenderMode | null,
): ListRenderMode {
  return count <= LIST_FULL_MAX_COUNT ? "full" : "virtual";
}
