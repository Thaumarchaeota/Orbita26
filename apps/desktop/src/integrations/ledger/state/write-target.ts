import { DEFAULT_WRITE_TARGET } from "../constants";

let writeTarget = DEFAULT_WRITE_TARGET;

export function getWriteTarget(): string {
  return writeTarget;
}

export function setWriteTarget(target: string): void {
  writeTarget = target || DEFAULT_WRITE_TARGET;
}
