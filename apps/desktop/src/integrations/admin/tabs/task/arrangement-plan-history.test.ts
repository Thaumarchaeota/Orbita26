import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActionSnapshot, CommitActionArrangementRequest, SessionSnapshot } from "../../../productivity/types";
import { ArrangementHistory } from "./arrangement-history";
import { actionArrangementState, createArrangementPlanHistory, type ArrangementPlanGraph } from "./arrangement-plan-history";

const api = vi.hoisted(() => ({
  productivityCommitActionArrangement: vi.fn(), productivityRestoreActionArrangementState: vi.fn(),
  productivityCommitSessionBoundary: vi.fn(), productivityRestoreSessionBoundaryState: vi.fn(),
  productivityCommitCheckpointArrangement: vi.fn(), productivityMutateHealthPlan: vi.fn(), productivityListWeekHealth: vi.fn(),
}));
vi.mock("../../../productivity/client", () => api);
const time = (hour: number) => `2026-11-01T${String(hour).padStart(2,"0")}:00:00Z`;
const initialAction = (): ActionSnapshot => ({ id:"a",revision:1,title:"安排",nameLinkMode:"unlinked",targetKind:null,targetId:null,
  plannedStartAt:null,plannedEndAt:null,plannedDuration:90,sessionId:null,ended:false,executionState:"未开始",intervals:[],
  createdAtUtc:time(0),updatedAtUtc:time(0),deletedAtUtc:null });
function fixture() {
  let graph: ArrangementPlanGraph = {actions:[initialAction()],sessions:[],checkpoints:[],items:[],projects:[],lists:[]};
  const report = vi.fn(), refresh = vi.fn().mockResolvedValue(undefined);
  const history = new ArrangementHistory({ownerId:"test-owner",epoch:1,expectedDataDir:"test-dir"},()=>true,report);
  const adapter = createArrangementPlanHistory({history,snapshot:()=>graph,read:async()=>graph,isCurrent:()=>true,report,refresh,
    install(changes) { graph={...graph,actions:graph.actions.map(a=>changes.actions?.find(n=>n.id===a.id)??a),sessions:graph.sessions.map(s=>changes.sessions?.find(n=>n.id===s.id)??s)}; },
  });
  api.productivityCommitActionArrangement.mockImplementation(async(req)=>({action:{...graph.actions[0],revision:graph.actions[0].revision+1,plannedStartAt:req.plannedStartAt,plannedEndAt:req.plannedEndAt,plannedDuration:null,sessionId:req.nextSession?.id??null}}));
  api.productivityRestoreActionArrangementState.mockImplementation(async(req)=>({action:{...graph.actions[0],...req.targetState,revision:graph.actions[0].revision+1}}));
  const request = (start:number):CommitActionArrangementRequest => ({expectedDataDir:"test-dir",action:{id:"a",expectedRevision:graph.actions[0].revision},targetOwningRoot:null,currentSession:null,currentSessionMembers:[],nextSession:null,nextSessionMembers:[],plannedStartAt:time(start),plannedEndAt:time(start+1)});
  return {history,adapter,request,report,refresh,get:()=>graph,set:(next:ArrangementPlanGraph)=>{graph=next;}};
}
beforeEach(()=>{ vi.resetAllMocks(); });

describe("ordinary plan compensation",()=>{
  it("records a committed duration-only plan even when its subsequent refresh fails",async()=>{
    const f=fixture();f.refresh.mockRejectedValue(new Error("read unavailable"));
    await f.adapter.action(f.request(10));
    expect(f.history.canUndo).toBe(true);
    expect(api.productivityCommitActionArrangement).toHaveBeenCalledTimes(1);
    await f.history.replay("undo");
    expect(api.productivityRestoreActionArrangementState).toHaveBeenCalledWith(expect.objectContaining({
      action:{id:"a",expectedRevision:2},targetState:{plannedStartAt:null,plannedEndAt:null,plannedDuration:90,sessionId:null},
    }));
    expect(actionArrangementState(f.get().actions[0])).toEqual(actionArrangementState(initialAction()));
    expect(f.history.canRedo).toBe(true);
  });

  it("uses the confirmed graph for consecutive undo/redo and preserves newer unrelated text",async()=>{
    const f=fixture();await f.adapter.action(f.request(10));await f.adapter.action(f.request(12));
    await f.history.replay("undo");await f.history.replay("undo");
    const requests=api.productivityRestoreActionArrangementState.mock.calls.map(call=>call[0]);
    expect(requests.map(r=>r.action.expectedRevision)).toEqual([3,4]);
    f.set({...f.get(),actions:[{...f.get().actions[0],title:"新的文字",revision:20}]});
    await f.history.replay("redo");
    expect(api.productivityRestoreActionArrangementState.mock.calls.at(-1)?.[0].action.expectedRevision).toBe(20);
    expect(f.get().actions[0].title).toBe("新的文字");
    expect(f.get().actions[0].plannedStartAt).toBe(time(10));
  });

  it("rejects an external plan change without moving the cursor or issuing compensation",async()=>{
    const f=fixture();await f.adapter.action(f.request(10));
    f.set({...f.get(),actions:[{...f.get().actions[0],plannedStartAt:time(8),revision:9}]});
    await f.history.replay("undo");
    expect(api.productivityRestoreActionArrangementState).not.toHaveBeenCalled();
    expect(f.history.canUndo).toBe(true);
    expect(f.report).toHaveBeenCalledWith(expect.stringContaining("已变化"));
  });

  it.each([new Error("connection lost"), JSON.stringify({code:"ARCHIVE_LIFECYCLE_ERROR",message:"commit failed"})])("freezes an unconfirmed commit and never retries it: %s",async(error)=>{
    const f=fixture();api.productivityCommitActionArrangement.mockRejectedValue(error);
    await expect(f.adapter.action(f.request(10))).rejects.toThrow("结果待核实");
    expect(f.history.isFrozen).toBe(true);
    await expect(f.adapter.action(f.request(12))).rejects.toThrow("结果待核实");
    expect(api.productivityCommitActionArrangement).toHaveBeenCalledTimes(1);
  });

  it("restores all boundary-detached members in one guarded session transaction",async()=>{
    const f=fixture();
    const session:SessionSnapshot={id:"s",revision:1,title:"工作",plannedStartAt:time(9),plannedEndAt:time(13),trackLane:0,trackSpan:1,actualRange:{},createdAtUtc:time(0),updatedAtUtc:time(0),deletedAtUtc:null};
    const action={...initialAction(),plannedStartAt:time(10),plannedEndAt:time(11),plannedDuration:null,sessionId:"s"};
    f.set({...f.get(),sessions:[session],actions:[action]});
    api.productivityCommitSessionBoundary.mockResolvedValue({session:{...session,revision:2,plannedStartAt:time(11),plannedEndAt:time(12)},actions:[{...action,revision:2,sessionId:null}]});
    api.productivityRestoreSessionBoundaryState.mockImplementation(async(req)=>({session:{...f.get().sessions[0],...req.targetState,revision:3},actions:[{...f.get().actions[0],sessionId:"s",revision:3}]}));
    await f.adapter.session({expectedDataDir:"test-dir",session:{id:"s",expectedRevision:1},expectedMembers:[{id:"a",expectedRevision:1}],expectedCheckpoints:[],plannedStartAt:time(11),plannedEndAt:time(12)});
    await f.history.replay("undo");
    expect(api.productivityRestoreSessionBoundaryState).toHaveBeenCalledTimes(1);
    expect(api.productivityRestoreSessionBoundaryState).toHaveBeenCalledWith(expect.objectContaining({expectedMembers:[],targetMemberIds:["a"],membershipChanges:[{action:{id:"a",expectedRevision:2},targetOwningRoot:null,expectedSessionId:null,targetSessionId:"s"}]}));
    expect(api.productivityRestoreActionArrangementState).not.toHaveBeenCalled();
    expect(f.get().actions[0].sessionId).toBe("s");
  });
});
