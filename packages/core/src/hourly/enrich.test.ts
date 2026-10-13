import { beforeAll, describe, expect, it } from "vitest";
import { enrichRows, siteMap, type SiteInfo } from "./enrich.js";
import { compileNormalizer, DEFAULT_HOURLY_NORMALIZATIONS } from "./normalize.js";
import type { RawHourlyRow } from "./parse.js";
import { parseSiteMasterXlsx, type SiteMasterParse } from "./siteMaster.js";
import { readFixture, SITE_MASTER_XLSX } from "./test-fixtures.js";

const normalize = compileNormalizer(DEFAULT_HOURLY_NORMALIZATIONS);

const raw = (code: string, over: Partial<RawHourlyRow> = {}): RawHourlyRow => ({
  alarmNumber: "7767",
  alarmType: "",
  alarmTime: "2026-10-13 07:00:00",
  alarmText: "BCCH MISSING",
  alarmName: "BCCH MISSING",
  dn: `PLMN-PLMN/BSC-1/BCF-${code}`,
  objectClass: "BTS",
  name: "",
  siteName: "",
  code,
  supplementaryInfo: "",
  technologies: ["2G"],
  sheet: "2G_Down",
  sheets: ["2G_Down"],
  clockInvalid: false,
  ...over,
});

describe.skipIf(!SITE_MASTER_XLSX)("SiteMaster fixture join", () => {
  let parsed: SiteMasterParse;
  beforeAll(async () => {
    parsed = await parseSiteMasterXlsx(readFixture(SITE_MASTER_XLSX));
  });

  it("parses the SiteMaster sheet (Code, Office, VIP, …) and ignores extra columns", () => {
    // 138 data rows; 0970DE appears three times → first kept, the repeats reported as skipped
    expect(parsed.rows.length).toBe(136);
    expect(parsed.skipped).toEqual([
      { row: 38, code: "0970DE", reason: "duplicate code in file" },
      { row: 48, code: "0970DE", reason: "duplicate code in file" },
    ]);
    const s = parsed.rows.find((r) => r.code === "0560DE")!;
    expect(s).toMatchObject({ office: "KAFR EL DAWAR", vip: true, nodality: "1+6", region: "DE" });
    expect(Object.keys(s)).not.toContain("guardNumber");
  });

  it("resolves 0648DE and 3273DE to KAFR EL DAWAR and counts the unknown code", () => {
    const { rows, unmatchedCodes, emptyCodes } = enrichRows(
      [raw("0648DE"), raw("3273DE"), raw("ZZ99DE"), raw("ZZ99DE"), raw("")],
      siteMap(parsed.rows),
      normalize,
    );
    expect(rows[0]).toMatchObject({ code: "0648DE", office: "KAFR EL DAWAR", unmatched: false });
    expect(rows[1]).toMatchObject({
      code: "3273DE",
      office: "KAFR EL DAWAR",
      powerSource: "EC",
      nodality: "1+0",
      vip: false,
      region: "DE",
    });
    expect(rows[2]).toMatchObject({ office: "", vip: null, unmatched: true, region: "DE" });
    expect(unmatchedCodes).toBe(1); // distinct codes
    expect(emptyCodes).toBe(1);
  });
});

describe("enrichRows", () => {
  const sites = siteMap([
    { code: "1155AL", office: "damnhour", vip: true, siteType: "shelter ", nodality: "1+2" } as SiteInfo,
  ]);

  it("normalizes SiteMaster values and alarm names, derives region and category", () => {
    const { rows } = enrichRows(
      [
        raw("1155al", {
          sheet: "Environmental",
          sheets: ["Environmental"],
          technologies: [],
          alarmText: "BASE STATION EXTERNAL ALARM NOTIFICATION",
          alarmName: "MAIN POWER  CUTTOFF",
          supplementaryInfo: "MAIN POWER  CUTTOFF",
        }),
        raw("1155AL", { sheet: "Environmental", sheets: ["Environmental"], alarmName: "Shelter Doo" }),
        raw("1155AL", { sheet: "HW", sheets: ["HW"], alarmName: "BATTERY X" }),
      ],
      sites,
      normalize,
    );
    expect(rows[0]).toMatchObject({
      code: "1155AL",
      office: "DAMANHOUR",
      siteType: "SHELTER",
      vip: true,
      region: "AL",
      alarmName: "MAIN POWER CUT OFF",
      supplementaryInfo: "MAIN POWER CUT OFF",
      category: "POWER",
    });
    expect(rows[1]).toMatchObject({ alarmName: "SHELTER DOOR", category: "OTHER" });
    expect(rows[2]!.category).toBe("OTHER"); // POWER only for Environmental
    expect(rows.map((r) => r.id)).toEqual([0, 1, 2]);
  });

  it("Down sheets are always DOWN", () => {
    const { rows } = enrichRows([raw("X1"), raw("X1", { sheet: "5G_Down" })], sites, normalize);
    expect(rows.map((r) => r.category)).toEqual(["DOWN", "DOWN"]);
  });
});
