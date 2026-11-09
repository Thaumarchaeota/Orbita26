import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TravelEditPlanPayload, TravelMutationResult, TripSnapshot } from "./types";
const mocks = vi.hoisted(() => ({ edit: vi.fn(), replay: vi.fn(), release: vi.fn(), receipt: vi.fn() }));
vi.mock("./client", async (original) => ({
  ...await original<typeof import("./client")>(),
  productivityTravelV2EditPlan: mocks.edit,
  productivityTravelV2ReplayPlanEffect: mocks.replay,
  productivityTravelV2ReleasePlanHistory: mocks.release,
  productivityTravelV2GetReceipt: mocks.receipt,
}));
import { TravelController } from "./controller";

const scope = { ownerId: "host:epoch:destination", hostEpoch: 1 };
function snapshot(revision = 1): TripSnapshot {
  return {
    item: { id: "trip", revision, title: "Trip", completed: false, cancelled: false, status: "进行中", listId: null },
    profile: { itemId: "trip", schemaVersion: 1, cancelledAtUtc: null, createdAtUtc: "", updatedAtUtc: "" },
    actions: [], checkpoints: [], points: [], transportations: [], canonicalPoints: [], segments: [],
    memberRefs: { item: { id: "trip", expectedRevision: revision }, actions: [], checkpoints: [] },
    capabilities: { canEditStructure: true, canEditPlan: true, canEditText: true, canChangeTransportationType: true,
      canRecordActual: true, canFinish: true, canCancel: true, canAppend: true },
  };
}
function result(requestId: string, revision = 2): TravelMutationResult {
  return { changed: true, snapshot: snapshot(revision), affectedRootRefs: [], planHistoryToken: "token",
    planHistory: { ...scope, requestId, sequence: 1, phase: "applied", available: true } };
}
function controller(refresh?: () => void): TravelController {
  const c = new TravelController({ expectedDataDir: "root", historyScope: scope, onSnapshotCommitted: refresh });
  c.acceptSnapshot(snapshot(), { expectedDataDir: "root", contextEpoch: 0 });
  return c;
}
const payload: TravelEditPlanPayload = { edit: { kind: "moveGroup", actionIds: ["action"], deltaMinutes: 5,
  splitPolicies: { movingFrontEnd: "copy", movingRearStart: "copy" } } };

describe("travel plan commit receipts", () => {
  beforeEach(() => {
    vi.clearAllMocks(); mocks.release.mockResolvedValue(undefined); mocks.receipt.mockResolvedValue({ status: "not_found" });
  });

  it("delivers committed before a failing refresh and does not retry the write", async () => {
    mocks.edit.mockImplementation(async (req) => result(req.requestId));
    const c = controller(() => { throw new Error("refresh failed"); });
    const outcome = await c.queueEditPlan("trip", payload);
    await Promise.resolve(); await Promise.resolve();
    expect(outcome.status).toBe("committed");
    expect(outcome.result?.planHistoryToken).toBe("token");
    expect(c.getState().failedCommitCount).toBe(0);
    expect(mocks.edit).toHaveBeenCalledTimes(1);
    expect(mocks.receipt).not.toHaveBeenCalled(); c.dispose();
  });

  it("keeps queued replay on the same serial channel and uses committed canonical refs", async () => {
    let finish!: (value: TravelMutationResult) => void;
    mocks.edit.mockImplementation((req) => new Promise((resolve) => { finish = () => resolve(result(req.requestId)); }));
    mocks.replay.mockImplementation(async (req) => ({ ...result(req.requestId, 3),
      planHistory: { ...scope, requestId: req.requestId, sequence: 2, phase: "undone", available: true } }));
    const c = controller(); const editing = c.queueEditPlan("trip", payload);
    const replaying = c.queueReplayPlanEffect("trip", "token", "undo");
    expect(mocks.replay).not.toHaveBeenCalled(); finish(result("unused"));
    expect((await editing).status).toBe("committed"); expect((await replaying).status).toBe("committed");
    expect(mocks.replay.mock.calls[0][0].currentTripRefs.item.expectedRevision).toBe(2); c.dispose();
  });

  it("reconciles a lost response using its original request and freezes when unavailable", async () => {
    let requestId = "";
    mocks.edit.mockImplementation(async (req) => { requestId = req.requestId; throw new Error("lost response"); });
    mocks.receipt.mockImplementation(async () => result(requestId));
    const c = controller(); expect((await c.queueEditPlan("trip", payload)).status).toBe("committed");
    expect(mocks.receipt.mock.calls[0][0].requestId).toBe(requestId);
    mocks.receipt.mockResolvedValue({ status: "not_found" });
    expect((await c.queueEditPlan("trip", payload)).status).toBe("uncertain");
    expect((await c.queueReplayPlanEffect("trip", "token", "undo")).status).toBe("uncertain");
    expect(mocks.edit).toHaveBeenCalledTimes(2); c.dispose();
  });

  it("cancels stale generations and releases only its captured owner on directory change", async () => {
    const c = controller(); c.bumpPlanEditGeneration();
    expect((await c.queueEditPlan("trip", { edit: { kind: "setRange", actionId: "action", plannedStartAt: "2026-10-31T10:00:00Z",
      plannedEndAt: "2026-10-31T11:00:00Z", planEditGeneration: 0 } })).status).toBe("cancelled");
    expect(mocks.edit).not.toHaveBeenCalled(); c.setExpectedDataDir("next"); await Promise.resolve();
    expect(mocks.release).toHaveBeenCalledWith({ expectedDataDir: "root", historyOwnerId: scope.ownerId, hostEpoch: 1, all: true }); c.dispose();
  });

  it("releases a late committed token without installing its old directory snapshot", async () => {
    let finish!: () => void;
    mocks.edit.mockImplementation((req) => new Promise((resolve) => { finish = () => resolve(result(req.requestId)); }));
    const c = controller(); const pending = c.queueEditPlan("trip", payload);
    c.setExpectedDataDir("next"); finish();
    expect((await pending).status).toBe("cancelled");
    expect(c.getState().currentSnapshot).toBeNull();
    expect(mocks.release).toHaveBeenCalledWith({ expectedDataDir: "root", historyOwnerId: scope.ownerId, hostEpoch: 1, all: false, tokenIds: ["token"] }); c.dispose();
  });

  it("settles a queued plan when drafts are abandoned behind an in-flight text write", async () => {
    let finish!: () => void;
    const c = controller();
    c.enqueueMutation("trip", ({ requestId, snapshot, expectedDataDir }) => ({ requestId, expectedDataDir,
      itemRef: snapshot!.memberRefs.item, actionRefs: [], checkpointRefs: [], payload: {} }),
      (req) => new Promise((resolve) => { finish = () => resolve(result(req.requestId)); }));
    const queued = c.queueEditPlan("trip", payload); c.abandonDrafts("trip");
    expect((await queued).status).toBe("cancelled"); expect(mocks.edit).not.toHaveBeenCalled();
    finish(); await Promise.resolve(); c.dispose();
  });

  it("settles plans already queued when an earlier result freezes history", async () => {
    let reject!: (error: Error) => void;
    mocks.edit.mockImplementation(() => new Promise((_resolve, fail) => { reject = fail; }));
    const c = controller(); const first = c.queueEditPlan("trip", payload); const second = c.queueEditPlan("trip", payload);
    reject(new Error("lost response"));
    expect((await first).status).toBe("uncertain"); expect((await second).status).toBe("uncertain");
    expect(mocks.edit).toHaveBeenCalledTimes(1); c.dispose();
  });

  it("keeps new edits frozen until reset release completes", async () => {
    let released!: () => void;
    mocks.release.mockImplementation(() => new Promise<void>((resolve) => { released = resolve; }));
    mocks.edit.mockImplementation(async (req) => result(req.requestId));
    const c = controller(); const resetting = c.resetPlanHistory(scope); await Promise.resolve();
    expect((await c.queueEditPlan("trip", payload)).status).toBe("uncertain"); expect(mocks.edit).not.toHaveBeenCalled();
    released(); await resetting;
    expect((await c.queueEditPlan("trip", payload)).status).toBe("committed"); c.dispose();
  });
});
