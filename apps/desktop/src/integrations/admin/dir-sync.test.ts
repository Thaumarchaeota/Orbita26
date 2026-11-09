import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createIdempotentDataDirHandler,
  notifyDataDirChanged,
  parseDataDirChangeStamp,
} from "../../../core/data/dir-sync";

vi.mock("../../../core/data/client", () => ({ isTauri: () => false }));

const REV_KEY = "orbita.data.dir-rev";

describe("dir-sync", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("roundtrips notify stamp version and dataDir through storage and events", () => {
    const seen: unknown[] = [];
    const onEvent = (e: Event) => seen.push((e as CustomEvent).detail);
    window.addEventListener("orbita:data-dir-changed", onEvent);

    const stamp = notifyDataDirChanged("D:/orbita-next");
    const stored = parseDataDirChangeStamp(localStorage.getItem(REV_KEY));

    expect(stored).toEqual(stamp);
    expect(stored?.version).toBeTruthy();
    expect(stored?.dataDir).toBe("D:/orbita-next");
    expect(seen).toEqual([stamp]);

    window.removeEventListener("orbita:data-dir-changed", onEvent);
  });

  it("ignores duplicate versions and accepts a new version", () => {
    const handler = vi.fn();
    const deliver = createIdempotentDataDirHandler(handler);
    const first = { version: "rev-a", dataDir: "D:/a" };
    const duplicate = { version: "rev-a", dataDir: "D:/a" };
    const next = { version: "rev-b", dataDir: "D:/b" };

    deliver(first);
    deliver(duplicate);
    deliver(next);

    expect(handler).toHaveBeenCalledTimes(2);
    expect(handler.mock.calls[0]?.[0]).toEqual(first);
    expect(handler.mock.calls[1]?.[0]).toEqual(next);
  });
});
