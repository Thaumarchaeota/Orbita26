import type { TravelController } from "../../../productivity/travel-v2";
import { productivityTravelV2ReleasePlanHistory } from "../../../productivity/travel-v2/client";
import type { TravelEditPlanPayload, TravelPlanCommitOutcome } from "../../../productivity/travel-v2/types";
import { productivityGetTravel, productivityUpdateTravel } from "../../../productivity/client";
import type { TravelRangeInput, TravelSnapshot, UpdateTravelRequest } from "../../../productivity/types";
import { ArrangementCommitUncertain, type ArrangementHistory, type ArrangementHistoryOperation, type ArrangementReplayResult } from "./arrangement-history";

type Options = { history: ArrangementHistory; isCurrent: () => boolean; installLegacy: (snapshot: TravelSnapshot) => void; refresh: () => Promise<void>; report: (message: string) => void };
const ref = (value: {id:string;revision:number}) => ({id:value.id,expectedRevision:value.revision});
const ranges = (snapshot: TravelSnapshot): TravelRangeInput[] => snapshot.legs.map((leg) => {
  const action = snapshot.actions.find((value) => value.id === leg.actionId);
  if (!action) throw new Error("行程段关联已变化，不能撤销。");
  return { plannedStartAt:action.plannedStartAt??null,plannedEndAt:action.plannedEndAt??null,
    departureCode:leg.departureCode,departureName:leg.departureName,arrivalCode:leg.arrivalCode,arrivalName:leg.arrivalName,
    departureTerminal:leg.departureTerminal,arrivalTerminal:leg.arrivalTerminal,departureGate:leg.departureGate,arrivalGate:leg.arrivalGate };
});
export const legacyTravelPlanEffect = (snapshot:TravelSnapshot): string => JSON.stringify({
  item:{id:snapshot.item.id,status:snapshot.item.status,deleted:snapshot.item.deletedAtUtc??null,kind:snapshot.item.travelKind??null},
  profile:snapshot.detail?{kind:snapshot.detail.kind,schema:snapshot.detail.schemaVersion,deleted:snapshot.detail.deletedAtUtc??null}:null,
  legs:snapshot.legs.map(leg=>({id:leg.id,actionId:leg.actionId,position:leg.position,itemId:leg.itemId,deleted:leg.deletedAtUtc??null})),
  actions:snapshot.actions.map(a=>({id:a.id,start:a.plannedStartAt??null,end:a.plannedEndAt??null,duration:a.plannedDuration??null,session:a.sessionId??null,
    targetKind:a.targetKind??null,targetId:a.targetId??null,ended:a.ended,execution:a.executionState,deleted:a.deletedAtUtc??null,
    intervals:a.intervals.map(i=>[i.id,i.startedAt,i.endedAt??null,i.deletedAtUtc??null])})),
});
function knownLegacyRejection(error:unknown):boolean {
  // Lifecycle errors include an uncertain COMMIT result, so they must freeze history.
  try {const value=typeof error==="string"?JSON.parse(error):error;return !!value&&typeof value==="object"&&["REVISION_CONFLICT","ROOT_NOT_FOUND","ROOT_DELETED","UNKNOWN_FIELD_WRITE_BLOCKED","INVALID_PATCH","INVALID_TIME_VALUE","ACTION_EXECUTION_STATE_INVALID","ACTION_OUTSIDE_SESSION","SESSION_INTERVAL_CONFLICT","ARCHIVED_LIST_READONLY","ARCHIVE_BUSY"].includes((value as {code:string}).code);}catch{return false;}
}
export function createArrangementTravelHistory(opts:Options) {
  const {ownerId,epoch:hostEpoch,expectedDataDir}=opts.history.scope;
  async function refreshCommitted(){if(!opts.isCurrent())return;try{await opts.refresh();}catch(error){opts.report(`行程计划已保存，页面刷新失败；撤销记录保留：${String(error)}`);}}
  function outcomeError(outcome:TravelPlanCommitOutcome):never {
    if(outcome.status==="uncertain")throw new ArrangementCommitUncertain("行程计划结果待核实。请刷新核对并清空撤销历史，不要重新提交。");
    throw outcome.error??new Error("行程计划未保存。");
  }
  async function v2(controller:TravelController,itemId:string,payload:TravelEditPlanPayload):Promise<void> {
    await opts.history.forward(async()=>{
      // This coordinates the instance history; all actual writes still use the controller's existing queue.
      const outcome=await controller.queueEditPlan(itemId,{...payload,historyScope:{ownerId,hostEpoch}});
      if(outcome.status==="uncertain"||outcome.status==="failed")outcomeError(outcome);
      if(outcome.status!=="committed")return {status:outcome.status,value:undefined};
      const result=outcome.result, token=result?.planHistoryToken, state=result?.planHistory;
      if(!result||!token||!state?.available||state.ownerId!==ownerId||state.hostEpoch!==hostEpoch||state.requestId!==outcome.requestId||state.phase!=="applied"){
        opts.report("行程计划已保存，但本次撤销记录不可用。");
        return {status:"committed" as const,value:undefined};
      }
      let sequence=state.sequence;
      const entry:ArrangementHistoryOperation={id:`travel:${token}`,label:"调整行程计划",
        async replay(direction):Promise<ArrangementReplayResult>{
          if(!opts.isCurrent())return {status:"cancelled"};
          try{await controller.loadTrip(itemId);}catch(error){return {status:"failed",message:`行程读取失败：${String(error)}`};}
          if(!opts.isCurrent())return {status:"cancelled"};
          const replay=await controller.queueReplayPlanEffect(itemId,token,direction);
          if(replay.status==="uncertain")return {status:"uncertain",message:"行程计划结果待核实，请刷新核对并清空撤销历史。"};
          if(replay.status==="failed")return {status:"failed",message:String(replay.error??"行程计划已变化，不能撤销。")};
          if(replay.status!=="committed")return {status:replay.status};
          const phase=replay.result?.planHistory;
          if(!phase?.available||phase.ownerId!==ownerId||phase.hostEpoch!==hostEpoch||phase.requestId!==replay.requestId||phase.sequence<=sequence||phase.phase!==(direction==="undo"?"undone":"applied"))return {status:"uncertain",message:"行程修改已保存，但撤销回执阶段待核实。请刷新核对并清空撤销历史。"};
          sequence=phase.sequence;await refreshCommitted();return {status:"committed"};
        },
        release(){void productivityTravelV2ReleasePlanHistory({expectedDataDir,historyOwnerId:ownerId,hostEpoch,all:false,tokenIds:[token]}).catch(error=>opts.report(`行程撤销资源清理失败：${String(error)}`));},
      };
      return {status:"committed" as const,value:undefined,operation:entry};
    });
    await refreshCommitted();
  }
  async function legacy(req:UpdateTravelRequest,before:TravelSnapshot):Promise<TravelSnapshot> {
    const beforeRanges=ranges(before);
    const hasPlanChange=!!req.ranges&&req.ranges.some((range,index)=>range.plannedStartAt!==beforeRanges[index]?.plannedStartAt||range.plannedEndAt!==beforeRanges[index]?.plannedEndAt);
    if(!hasPlanChange)return productivityUpdateTravel({...req,expectedDataDir});
    const write=async(request:UpdateTravelRequest)=>{
      if(!opts.isCurrent())throw new Error("安排实例或数据目录已变化。");
      try{return await productivityUpdateTravel({...request,expectedDataDir});}
      catch(error){if(knownLegacyRejection(error))throw error;throw new ArrangementCommitUncertain("行程计划结果待核实。请刷新核对并清空撤销历史，不要重试原请求。");}
    };
    const result=await opts.history.forward(async()=>{
      const receipt=await write(req),itemId=before.item.id;
      const beforeTimes=before.legs.map((leg,index)=>({legId:leg.id,actionId:leg.actionId,start:beforeRanges[index].plannedStartAt??null,end:beforeRanges[index].plannedEndAt??null}));
      const afterRanges=ranges(receipt),afterTimes=receipt.legs.map((leg,index)=>({legId:leg.id,actionId:leg.actionId,start:afterRanges[index].plannedStartAt??null,end:afterRanges[index].plannedEndAt??null}));
      let beforeEffect=legacyTravelPlanEffect(before),afterEffect=legacyTravelPlanEffect(receipt);
      const entry:ArrangementHistoryOperation={id:crypto.randomUUID(),label:"调整原有行程计划",async replay(direction){
        let current:TravelSnapshot;
        try{current=await productivityGetTravel({itemId,includeDeleted:false});}catch(error){return {status:"failed",message:`行程读取失败：${String(error)}`};}
        if(!opts.isCurrent())return {status:"cancelled"};
        if(legacyTravelPlanEffect(current)!==(direction==="undo"?afterEffect:beforeEffect))return {status:"failed",message:"行程计划、成员或执行状态已变化，不能撤销。"};
        const desired=direction==="undo"?beforeTimes:afterTimes;
        const nextRanges=ranges(current).map((range,index)=>{const leg=current.legs[index],target=desired.find(value=>value.legId===leg.id&&value.actionId===leg.actionId);if(!target)throw new Error("行程结构已变化，不能撤销。");return {...range,plannedStartAt:target.start,plannedEndAt:target.end};});
        const restored=await write({expectedDataDir,item:ref(current.item),actionRevisions:current.actions.map(ref),ranges:nextRanges});
        if(!opts.isCurrent())return {status:"cancelled"};
        if(direction==="undo")beforeEffect=legacyTravelPlanEffect(restored);else afterEffect=legacyTravelPlanEffect(restored);
        opts.installLegacy(restored);await refreshCommitted();return {status:"committed"};
      }};
      opts.installLegacy(receipt);return {status:"committed" as const,value:receipt,operation:entry};
    });
    await refreshCommitted();return result;
  }
  return {v2,legacy};
}
