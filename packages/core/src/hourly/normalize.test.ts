import { describe, expect, it } from "vitest";
import { baseNormalize, compileNormalizer, DEFAULT_HOURLY_NORMALIZATIONS } from "./normalize.js";

const n = compileNormalizer(DEFAULT_HOURLY_NORMALIZATIONS);

describe("normalization (§14 seed)", () => {
  it("trims, collapses spaces and upper-cases", () => {
    expect(baseNormalize("  shelter   door \t open ")).toBe("SHELTER DOOR OPEN");
    expect(baseNormalize(null)).toBe("");
  });

  it('"MAIN POWER  CUTTOFF" → "MAIN POWER CUT OFF"', () => {
    expect(n("alarmName", "MAIN POWER  CUTTOFF")).toBe("MAIN POWER CUT OFF");
    expect(n("alarmName", "main power cuttoff")).toBe("MAIN POWER CUT OFF");
    expect(n("alarmName", "MAIN POWER  CUT OFF")).toBe("MAIN POWER CUT OFF");
  });

  it('"SHELTER DOO" → "SHELTER DOOR" without touching "SHELTER DOOR"', () => {
    expect(n("alarmName", "SHELTER DOO")).toBe("SHELTER DOOR");
    expect(n("alarmName", "SHELTER  DOOR")).toBe("SHELTER DOOR");
    expect(n("alarmName", "SHELTER DOOR OPEN")).toBe("SHELTER DOOR OPEN");
  });

  it("fixes tokens inside longer values (TEMPRATURE) and applies alarm rules to source columns", () => {
    expect(n("alarmName", "SHELTER HIGH TEMPRATURE")).toBe("SHELTER HIGH TEMPERATURE");
    expect(n("supplementaryInfo", "Shelter Doo")).toBe("SHELTER DOOR");
  });

  it('"*" rules apply to every field; field rules only to their field', () => {
    expect(n("office", "Damnhour")).toBe("DAMANHOUR");
    expect(n("siteType", "DAMNHOUR")).toBe("DAMANHOUR");
    expect(n("office", "SHELTER DOO")).toBe("SHELTER DOO");
  });
});
