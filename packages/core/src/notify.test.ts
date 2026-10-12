import { describe, expect, it } from "vitest";
import { DEFAULT_NOTIFY_PREFS, matchesPrefs, normalizePrefs, type NotifyPrefs } from "./notify.js";

const down = {
  category: "DOWN",
  alarmName: "S_D_N_BTS O&M LINK FAILURE",
  site: "U_S_BH-MHLT-KYL_3830DE",
};
const power = {
  category: "POWER",
  alarmName: "S_D_N_MAIN POWER CUT OFF",
  site: "SRAN_LWG_S_DM-DM-PRT_0436DE",
};
const other = {
  category: "OTHER",
  alarmName: "S_D_N_BCCH MISSING",
  site: "0301_S_SK-ADLIYA_3458DE",
};

const prefs = (p: Partial<NotifyPrefs>): NotifyPrefs => ({
  ...DEFAULT_NOTIFY_PREFS,
  categories: [],
  ...p,
});

describe("matchesPrefs", () => {
  it("defaults to DOWN alarms only", () => {
    expect(matchesPrefs(down, DEFAULT_NOTIFY_PREFS)).toBe(true);
    expect(matchesPrefs(power, DEFAULT_NOTIFY_PREFS)).toBe(false);
  });

  it("disabled → nothing", () => {
    expect(matchesPrefs(down, { ...DEFAULT_NOTIFY_PREFS, enabled: false })).toBe(false);
  });

  it("empty filters → every alarm", () => {
    expect([down, power, other].every((a) => matchesPrefs(a, prefs({})))).toBe(true);
  });

  it("several categories are OR-ed", () => {
    const p = prefs({ categories: ["DOWN", "POWER"] });
    expect([down, power, other].map((a) => matchesPrefs(a, p))).toEqual([true, true, false]);
  });

  it("alarm names match exactly, case-insensitive", () => {
    const p = prefs({ alarmNames: ["s_d_n_bcch missing"] });
    expect(matchesPrefs(other, p)).toBe(true);
    expect(matchesPrefs({ ...other, alarmName: "S_D_N_BCCH MISSING EXTRA" }, p)).toBe(false);
  });

  it("sites match by substring, case-insensitive", () => {
    const p = prefs({ sites: ["mhlt-kyl", "ADLIYA"] });
    expect([down, power, other].map((a) => matchesPrefs(a, p))).toEqual([true, false, true]);
  });

  it("dimensions are AND-ed (category AND site)", () => {
    const p = prefs({ categories: ["DOWN"], sites: ["ADLIYA"] });
    expect(matchesPrefs(down, p)).toBe(false); // DOWN but other site
    expect(matchesPrefs({ ...down, site: "X_ADLIYA_1" }, p)).toBe(true);
  });
});

describe("normalizePrefs", () => {
  it("null / garbage → defaults", () => {
    expect(normalizePrefs(null)).toEqual(DEFAULT_NOTIFY_PREFS);
    expect(normalizePrefs("x")).toEqual(DEFAULT_NOTIFY_PREFS);
  });

  it("drops unknown categories, blanks and duplicates", () => {
    expect(
      normalizePrefs({
        enabled: true,
        sound: false,
        categories: ["DOWN", "FIRE", "DOWN"],
        alarmNames: [" A ", "", "A"],
        sites: [1, "x"],
      }),
    ).toEqual({
      enabled: true,
      sound: false,
      categories: ["DOWN"],
      alarmNames: ["A"],
      sites: ["x"],
    });
  });
});
