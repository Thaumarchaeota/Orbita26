import { describe, expect, it, vi } from "vitest";
import { ArrangementHistory, type ArrangementHistoryOperation } from "./arrangement-history";

function fixture() {
  const report = vi.fn();
  const history = new ArrangementHistory({ ownerId: "host:work:1", epoch: 1, expectedDataDir: "synthetic-root" }, () => true, report);
  return { history, report };
}

async function add(history: ArrangementHistory, id: string, overrides: Partial<ArrangementHistoryOperation> = {}) {
  const operation: ArrangementHistoryOperation = { id, label: id, replay: vi.fn(async () => ({ status: "committed" as const })), ...overrides };
  await history.forward(async () => ({ status: "committed", value: undefined, operation }));
  return operation;
}

describe("persisted plan history", () => {
  it("keeps a failed top operation in place instead of undoing an older one", async () => {
    const { history, report } = fixture();
    const first = await add(history, "a");
    const last = await add(history, "b", { replay: vi.fn(async () => ({ status: "failed", message: "conflict" })) });
    await history.replay("undo");
    await history.replay("undo");
    expect(first.replay).not.toHaveBeenCalled();
    expect(last.replay).toHaveBeenCalledTimes(2);
    expect(report).toHaveBeenCalledWith("conflict");
    expect(history.canRedo).toBe(false);
  });

  it("does not destroy redo on a cancelled forward intent", async () => {
    const { history } = fixture();
    const last = await add(history, "a");
    await history.replay("undo");
    await history.forward(async () => ({ status: "cancelled", value: undefined }));
    await history.replay("redo");
    expect(last.replay).toHaveBeenLastCalledWith("redo", history.scope);
    expect(history.canUndo).toBe(true);
  });

  it("freezes an uncertain commit and only unfreezes on explicit clear", async () => {
    const { history } = fixture();
    const entry = await add(history, "a", { replay: vi.fn(async () => ({ status: "uncertain", message: "receipt missing" })) });
    await history.replay("undo");
    await history.replay("undo");
    expect(entry.replay).toHaveBeenCalledTimes(1);
    expect(history.isFrozen).toBe(true);
    history.clear();
    expect(history.isFrozen).toBe(false);
    expect(history.canUndo).toBe(false);
  });

  it("releases the forward branch on a new committed operation", async () => {
    const { history } = fixture();
    const release = vi.fn();
    await add(history, "a", { release });
    await history.replay("undo");
    await add(history, "b");
    expect(release).toHaveBeenCalledTimes(1);
    expect(history.canRedo).toBe(false);
  });

  it("also invalidates redo when a saved operation has no available history receipt", async () => {
    const { history } = fixture();
    const release = vi.fn();
    await add(history, "a", { release });
    await history.replay("undo");
    await history.forward(async () => ({ status: "committed", value: undefined }));
    expect(release).toHaveBeenCalledTimes(1);
    expect(history.canRedo).toBe(false);
  });
});
