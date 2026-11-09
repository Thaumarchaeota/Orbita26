import {beforeEach,describe,expect,it,vi} from "vitest";
import type {TravelController} from "../../../productivity/travel-v2";
import type {TravelPlanCommitOutcome} from "../../../productivity/travel-v2/types";
import type {TravelSnapshot} from "../../../productivity/types";
import {ArrangementHistory} from "./arrangement-history";
import {createArrangementTravelHistory} from "./arrangement-travel-history";
const api=vi.hoisted(()=>({productivityGetTravel:vi.fn(),productivityUpdateTravel:vi.fn(),productivityTravelV2ReleasePlanHistory:vi.fn()}));
vi.mock("../../../productivity/client",()=>api);
vi.mock("../../../productivity/travel-v2/client",()=>api);
const at=(h:number)=>`2026-11-01T${h}:00:00Z`;
const response=(requestId:string,sequence:number,phase:"applied"|"undone"):TravelPlanCommitOutcome=>({status:"committed",requestId,
  result:{changed:true,requestId,snapshot:{} as never,affectedRootRefs:[],planHistoryToken:"token",planHistory:{ownerId:"owner",hostEpoch:1,requestId,sequence,phase,available:true}}});
function harness(){
  const report=vi.fn(),history=new ArrangementHistory({ownerId:"owner",epoch:1,expectedDataDir:"dir"},()=>true,report);
  const installLegacy=vi.fn(),refresh=vi.fn().mockResolvedValue(undefined);
  return {history,report,installLegacy,refresh,adapter:createArrangementTravelHistory({history,isCurrent:()=>true,report,refresh,installLegacy})};
}
beforeEach(()=>{vi.resetAllMocks();api.productivityTravelV2ReleasePlanHistory.mockResolvedValue(undefined);});
describe("travel plan history",()=>{
  it("records only a committed token, replays through the same controller queue, then releases its owner-scoped token",async()=>{
    const f=harness();const controller={queueEditPlan:vi.fn().mockResolvedValue(response("edit",1,"applied")),loadTrip:vi.fn().mockResolvedValue(undefined),queueReplayPlanEffect:vi.fn().mockResolvedValue(response("undo",2,"undone"))};
    await f.adapter.v2(controller as unknown as TravelController,"trip",{edit:{kind:"moveGroup",actionIds:["a"],deltaMinutes:5}});
    expect(controller.queueEditPlan).toHaveBeenCalledWith("trip",expect.objectContaining({historyScope:{ownerId:"owner",hostEpoch:1}}));
    expect(f.history.canUndo).toBe(true);await f.history.replay("undo");
    expect(controller.queueReplayPlanEffect).toHaveBeenCalledWith("trip","token","undo");expect(f.history.canRedo).toBe(true);
    f.history.clear();expect(api.productivityTravelV2ReleasePlanHistory).toHaveBeenCalledWith({expectedDataDir:"dir",historyOwnerId:"owner",hostEpoch:1,all:false,tokenIds:["token"]});
  });
  it("keeps a committed history entry when later display refresh fails and freezes an uncertain response",async()=>{
    const f=harness();f.refresh.mockRejectedValue(new Error("read failed"));
    const controller={queueEditPlan:vi.fn().mockResolvedValueOnce(response("edit",1,"applied")).mockResolvedValueOnce({status:"uncertain"})};
    const payload={edit:{kind:"moveGroup" as const,actionIds:["a"],deltaMinutes:5}};
    await f.adapter.v2(controller as unknown as TravelController,"trip",payload);expect(f.history.canUndo).toBe(true);
    await expect(f.adapter.v2(controller as unknown as TravelController,"trip",payload)).rejects.toThrow("结果待核实");expect(f.history.isFrozen).toBe(true);
    expect(controller.queueEditPlan).toHaveBeenCalledTimes(2);
  });
  it("freezes a legacy lifecycle error because commit may have succeeded",async()=>{
    const f=harness();
    const trip={item:{id:"trip",revision:1,status:"进行中",travelKind:"flight",deletedAtUtc:null},detail:{kind:"flight",schemaVersion:1,deletedAtUtc:null},
      legs:[{id:"leg",itemId:"trip",actionId:"a",position:0,deletedAtUtc:null}],
      actions:[{id:"a",revision:1,plannedStartAt:at(10),plannedEndAt:at(11),sessionId:null,plannedDuration:null,targetKind:"item",targetId:"trip",ended:false,executionState:"未开始",intervals:[],deletedAtUtc:null}]} as unknown as TravelSnapshot;
    api.productivityUpdateTravel.mockRejectedValue(JSON.stringify({code:"ARCHIVE_LIFECYCLE_ERROR",message:"commit failed"}));
    await expect(f.adapter.legacy({expectedDataDir:"dir",item:{id:"trip",expectedRevision:1},actionRevisions:[{id:"a",expectedRevision:1}],ranges:[{plannedStartAt:at(12),plannedEndAt:at(13)}]},trip)).rejects.toThrow("结果待核实");
    expect(f.history.isFrozen).toBe(true);
    expect(api.productivityUpdateTravel).toHaveBeenCalledTimes(1);
  });
  it("restores legacy ranges with current refs while preserving newer unrelated location text",async()=>{
    const f=harness();
    let trip={item:{id:"trip",revision:1,title:"航班",status:"进行中",travelKind:"flight",deletedAtUtc:null},detail:{kind:"flight",schemaVersion:1,deletedAtUtc:null},
      legs:[{id:"leg",itemId:"trip",actionId:"a",position:0,departureName:"原地点",deletedAtUtc:null}],
      actions:[{id:"a",revision:1,plannedStartAt:at(10),plannedEndAt:at(11),sessionId:null,plannedDuration:null,targetKind:"item",targetId:"trip",ended:false,executionState:"未开始",intervals:[],deletedAtUtc:null}]} as unknown as TravelSnapshot;
    api.productivityGetTravel.mockImplementation(async()=>trip);
    api.productivityUpdateTravel.mockImplementation(async(req)=>{trip={...trip,item:{...trip.item,revision:trip.item.revision+1},legs:trip.legs.map((leg,index)=>({...leg,...req.ranges[index]})),actions:trip.actions.map((a,index)=>({...a,revision:a.revision+1,plannedStartAt:req.ranges[index].plannedStartAt,plannedEndAt:req.ranges[index].plannedEndAt}))};return trip;});
    f.installLegacy.mockImplementation((snapshot)=>{trip=snapshot;});
    await f.adapter.legacy({expectedDataDir:"dir",item:{id:"trip",expectedRevision:1},actionRevisions:[{id:"a",expectedRevision:1}],ranges:[{plannedStartAt:at(12),plannedEndAt:at(13),departureName:"原地点"}]},trip);
    trip={...trip,item:{...trip.item,revision:40},legs:[{...trip.legs[0],departureName:"新地点"}]};
    await f.history.replay("undo");
    const req=api.productivityUpdateTravel.mock.calls.at(-1)?.[0];
    expect(req.item.expectedRevision).toBe(40);expect(req.ranges[0]).toMatchObject({plannedStartAt:at(10),plannedEndAt:at(11),departureName:"新地点"});
    expect(f.history.canRedo).toBe(true);
  });
});
