import { describe, expect, it } from "vitest";
import { diffFlightValues, formatFlightDiffValue, matchCandidatesByIata, mappedSourceValues } from "./flight-refresh";

describe("flight refresh mapping", () => {
  it("keeps only unique IATA matches", () => {
    const candidates = [
      { FlightNo: "CA123", FlightDepcode: "PEK", FlightArrcode: "SHA" },
      { FlightNo: "CA123", FlightDepcode: "PEK", FlightArrcode: "PVG" },
      { FlightNo: "CA123", depCode: "pek", arrCode: "sha" },
    ];
    expect(matchCandidatesByIata(candidates, "PEK", "SHA")).toHaveLength(2);
    expect(matchCandidatesByIata(candidates, "PEK", "CAN")).toHaveLength(0);
  });

  it("diffs mapped source fields and ignores missing source values", () => {
    const source = mappedSourceValues({
      FlightNo: "CA123",
      FlightCompany: "国航",
      FlightDepcode: "PEK",
      FlightArrcode: "SHA",
      FlightDeptimePlanDate: "2026-10-25 18:00:00",
      FlightArrtimePlanDate: "2026-10-25 20:00:00",
      org_timezone: "28800",
      dst_timezone: "28800",
    });
    expect(source.plannedStartAt).toBe("2026-10-25T10:00:00Z");
    expect(source.actualStart).toBeUndefined();
    const rows = diffFlightValues(
      { serviceNumber: "CA123", operator: "手填航司", departureCode: "PEK", arrivalCode: "SHA", plannedStartAt: "2026-10-25T09:00:00Z" },
      source,
    );
    expect(rows.map((row) => row.field)).toEqual(expect.arrayContaining(["operator", "plannedStartAt", "plannedEndAt"]));
    expect(rows.some((row) => row.field === "actualStart")).toBe(false);
  });

  it("preserves source seconds and displays refresh times in business local time", () => {
    const source = mappedSourceValues({
      FlightDeptimeDate: "2026-10-26 08:37:02",
      FlightArrtimeDate: "2026-10-26 11:33:24",
      org_timezone: "28800",
      dst_timezone: "28800",
    });
    expect(source.actualStart).toBe("2026-10-26T00:37:02Z");
    expect(source.actualEnd).toBe("2026-10-26T03:33:24Z");
    const zone = { baseOffset: "+08:00", replacements: [] };
    expect(formatFlightDiffValue("actualStart", source.actualStart!, zone)).toBe("2026-10-26 08:37:02");
    expect(formatFlightDiffValue("actualEnd", source.actualEnd!, zone)).toBe("2026-10-26 11:33:24");
    expect(diffFlightValues(
      { actualStart: "2026-10-26T00:37:02Z" },
      { actualStart: source.actualStart! },
    )).toHaveLength(0);
  });
});
