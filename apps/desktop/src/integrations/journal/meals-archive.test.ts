import { describe, expect, it } from "vitest";
import type { MealEntry } from "../../core/data/meals";
import {
  archiveMealToEntry,
  mealEntryToCreateReq,
  mealEntryToUpdateReq,
} from "./meals-archive";
import type { HealthMealSnapshot } from "./client";

describe("meals-archive adapter", () => {
  it("archiveMealToEntry maps snapshot fields and revision", () => {
    const snap: HealthMealSnapshot = {
      id: "meal-1",
      revision: 3,
      title: "午餐",
      startedAt: "2026-03-15T04:00:00Z",
      slot: "lunch",
      text: "沙拉",
      source: "manual",
      deletedAt: null,
      atHm: "12:00",
      recordShape: "foods",
      mealKcal: 320,
      foods: [
        {
          id: "f1",
          position: 0,
          text: "蔬菜",
          kcal: 320,
          kcalEstimated: false,
          servingText: null,
          servingEstimated: null,
          carbsGrams: null,
          proteinGrams: null,
          fatGrams: null,
          sugarGrams: null,
          fiberGrams: null,
          sodiumMilligrams: null,
          vitaminCMilligrams: null,
          nutrientsEstimated: null,
        },
      ],
    };
    const entry = archiveMealToEntry(snap, "2026-03-15");
    expect(entry).toMatchObject({
      id: "meal-1",
      title: "午餐",
      at: "12:00",
      slot: "lunch",
      text: "沙拉",
      kcal: 320,
      source: "manual",
      revision: 3,
      items: ["蔬菜"],
    });
  });

  it("mealEntryToCreateReq forces manual source and Beijing startedAt", () => {
    const entry: MealEntry = {
      id: "x",
      title: "2026-03-15 早餐",
      at: "08:30",
      slot: "breakfast",
      foods: [{ text: "粥", kcal: 200, kcalEstimated: false }],
      items: ["粥"],
      text: "粥",
      kcal: 200,
      source: "manual",
    };
    const req = mealEntryToCreateReq("2026-03-15", entry);
    expect(req.source).toBe("manual");
    expect(req.startedAt).toBe("2026-03-15T00:30:00Z");
    expect(req.atHm).toBe("08:30");
    expect(req.foods).toEqual([{ text: "粥", kcal: 200, kcalEstimated: false }]);
  });

  it("archiveMealToEntry maps foods snapshot without using legacy root kcal", () => {
    const snap: HealthMealSnapshot = {
      id: "meal-foods",
      revision: 2,
      title: "晚餐",
      startedAt: "2026-03-15T10:00:00Z",
      slot: "dinner",
      text: "鱼和蔬菜",
      source: "manual",
      deletedAt: null,
      atHm: "18:00",
      recordShape: "foods",
      mealKcal: 500,
      kcal: 999,
      items: ["应忽略"],
      foods: [
        {
          id: "f1",
          position: 0,
          text: "鱼",
          kcal: 300,
          kcalEstimated: false,
          servingText: null,
          servingEstimated: null,
          carbsGrams: null,
          proteinGrams: 30,
          fatGrams: null,
          sugarGrams: null,
          fiberGrams: null,
          sodiumMilligrams: null,
          vitaminCMilligrams: null,
          nutrientsEstimated: false,
        },
        {
          id: "f2",
          position: 1,
          text: "蔬菜",
          kcal: 200,
          kcalEstimated: true,
          servingText: "一碗",
          servingEstimated: false,
          carbsGrams: 12,
          proteinGrams: null,
          fatGrams: null,
          sugarGrams: null,
          fiberGrams: null,
          sodiumMilligrams: null,
          vitaminCMilligrams: null,
          nutrientsEstimated: false,
        },
      ],
    };
    const entry = archiveMealToEntry(snap, "2026-03-15");
    expect(entry.kcal).toBe(500);
    expect(entry.foods).toHaveLength(2);
    expect(entry.foods[0]).toMatchObject({
      text: "鱼",
      kcal: 300,
      kcalEstimated: false,
      proteinGrams: 30,
      nutrientsEstimated: false,
    });
    expect(entry.foods[1]).toMatchObject({
      text: "蔬菜",
      kcal: 200,
      kcalEstimated: true,
      servingText: "一碗",
      servingEstimated: false,
      carbsGrams: 12,
      nutrientsEstimated: false,
    });
    expect(entry.items).toEqual(["鱼", "蔬菜"]);
  });

  it("archiveMealToEntry maps legacy snapshot from root kcal and items", () => {
    const snap: HealthMealSnapshot = {
      id: "meal-legacy",
      revision: 1,
      title: null,
      startedAt: "2026-03-15T04:00:00Z",
      slot: "lunch",
      text: "旧餐",
      source: "manual",
      deletedAt: null,
      atHm: "12:00",
      recordShape: "legacy",
      mealKcal: 450,
      kcal: 450,
      items: ["米饭", "鸡肉"],
      foods: [],
    };
    const entry = archiveMealToEntry(snap, "2026-03-15");
    expect(entry.kcal).toBe(450);
    expect(entry.foods).toEqual([{ text: "米饭、鸡肉", kcal: 450, kcalEstimated: false }]);
    expect(entry.items).toEqual(["米饭、鸡肉"]);
    expect(entry.title).toBeUndefined();
  });

  it("archiveMealToEntry legacy and foods snapshots do not cross-drop fields", () => {
    const legacySnap: HealthMealSnapshot = {
      id: "legacy-only",
      revision: 1,
      title: null,
      startedAt: "2026-03-16T04:00:00Z",
      slot: "breakfast",
      text: "粥",
      source: "manual",
      deletedAt: null,
      atHm: "08:00",
      recordShape: "legacy",
      mealKcal: 200,
      kcal: 200,
      items: ["粥"],
      foods: [
        {
          id: "orphan",
          position: 0,
          text: "不应采用",
          kcal: 1,
          kcalEstimated: false,
          servingText: null,
          servingEstimated: null,
          carbsGrams: null,
          proteinGrams: null,
          fatGrams: null,
          sugarGrams: null,
          fiberGrams: null,
          sodiumMilligrams: null,
          vitaminCMilligrams: null,
          nutrientsEstimated: null,
        },
      ],
    };
    const foodsSnap: HealthMealSnapshot = {
      id: "foods-only",
      revision: 2,
      title: "午餐",
      startedAt: "2026-03-16T04:30:00Z",
      slot: "lunch",
      text: "",
      source: "manual",
      deletedAt: null,
      atHm: "12:30",
      recordShape: "foods",
      mealKcal: 320,
      kcal: 999,
      items: ["不应采用"],
      foods: [
        {
          id: "f1",
          position: 0,
          text: "沙拉",
          kcal: 320,
          kcalEstimated: false,
          servingText: null,
          servingEstimated: null,
          carbsGrams: null,
          proteinGrams: null,
          fatGrams: null,
          sugarGrams: null,
          fiberGrams: null,
          sodiumMilligrams: null,
          vitaminCMilligrams: null,
          nutrientsEstimated: null,
        },
      ],
    };

    const legacyEntry = archiveMealToEntry(legacySnap, "2026-03-16");
    expect(legacyEntry.foods).toEqual([{ text: "粥", kcal: 200, kcalEstimated: false }]);
    expect(legacyEntry.items).toEqual(["粥"]);

    const foodsEntry = archiveMealToEntry(foodsSnap, "2026-03-16");
    expect(foodsEntry.foods).toEqual([
      {
        text: "沙拉",
        kcal: 320,
        kcalEstimated: false,
        servingEstimated: null,
        carbsGrams: null,
        proteinGrams: null,
        fatGrams: null,
        sugarGrams: null,
        fiberGrams: null,
        sodiumMilligrams: null,
        vitaminCMilligrams: null,
        nutrientsEstimated: null,
      },
    ]);
    expect(foodsEntry.items).toEqual(["沙拉"]);
    expect(foodsEntry.kcal).toBe(320);
  });

  it("mealEntryToUpdateReq includes startedAt when at is set", () => {
    const entry: MealEntry = {
      id: "x",
      title: "2026-03-15 晚餐",
      at: "18:00",
      slot: "dinner",
      foods: [{ text: "鱼", kcal: 500, kcalEstimated: false }],
      items: ["鱼"],
      text: "晚餐",
      kcal: 500,
      source: "manual",
    };
    const req = mealEntryToUpdateReq("2026-03-15", entry);
    expect(req.startedAt).toBe("2026-03-15T10:00:00Z");
    expect(req.atHm).toBe("18:00");
    expect(req.foods).toEqual([{ text: "鱼", kcal: 500, kcalEstimated: false }]);
  });
});
