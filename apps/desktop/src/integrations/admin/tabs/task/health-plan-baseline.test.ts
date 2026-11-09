import { describe, expect, it } from "vitest";
import type { HealthPlanSnapshot } from "../../../productivity/types";
import { assertHealthPlanMoveBaseline } from "./health-plan-baseline";

const plan = (itemRevision=1,actionRevision=1) => ({item:{id:"item",revision:itemRevision},action:{id:"action",revision:actionRevision}} as HealthPlanSnapshot);
const baseline = {expectedDataDir:"dir:A",action:{id:"action",expectedRevision:1},targetOwningRoot:{id:"item",expectedRevision:1}};
describe("health drag intent",()=>{
  it("accepts only the captured Item/Action pair in the captured directory",()=>{
    expect(()=>assertHealthPlanMoveBaseline(plan(),baseline,"dir:A","dir:A")).not.toThrow();
  });
  it("rejects an Action refresh during the drag instead of adopting its new revision",()=>{
    expect(()=>assertHealthPlanMoveBaseline(plan(1,2),baseline,"dir:A","dir:A")).toThrow("拖动期间已变化");
  });
  it("rejects an Item-only refresh during the drag",()=>{
    expect(()=>assertHealthPlanMoveBaseline(plan(2,1),baseline,"dir:A","dir:A")).toThrow("拖动期间已变化");
  });
  it("rejects a changed directory or a missing captured root",()=>{
    expect(()=>assertHealthPlanMoveBaseline(plan(),baseline,"dir:A","dir:B")).toThrow();
    expect(()=>assertHealthPlanMoveBaseline(plan(),{...baseline,targetOwningRoot:null},"dir:A","dir:A")).toThrow();
  });
});
