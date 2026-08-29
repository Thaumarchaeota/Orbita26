import { describe, expect, it } from "vitest";
import { isBillDirectory } from "./index";

describe("admin data directory validation", () => {
  it("rejects selecting the bill directory itself", () => {
    expect(isBillDirectory("D:\\Orbita\\bill")).toBe(true);
    expect(isBillDirectory("D:/Orbita/BILL/")).toBe(true);
  });

  it("accepts the data root that contains bill", () => {
    expect(isBillDirectory("D:\\Orbita")).toBe(false);
    expect(isBillDirectory("D:/Orbita/billing")).toBe(false);
  });
});
