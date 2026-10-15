// Test-only helpers: locate the real fixtures (gitignored — real network data).
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { HourlyRow } from "./types.js";

const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../tests/fixtures");

/** First file in tests/fixtures matching `re` (names vary: "NSN Update_Output.rar" / "NSN_Update_Output.rar"). */
export function fixturePath(re: RegExp): string | null {
  if (!existsSync(FIXTURES)) return null;
  const f = readdirSync(FIXTURES).find((n) => re.test(n));
  return f ? path.join(FIXTURES, f) : null;
}

export const REPORT_RAR = fixturePath(/^NSN[ _]Update_Output\.rar$/i);
export const SITE_MASTER_XLSX = fixturePath(/^SiteMaster_.*\.xlsx$/i);

export const readFixture = (p: string | null): Buffer => readFileSync(p!);

/** A complete row with sensible defaults. */
let nextId = 0;
export const row = (over: Partial<HourlyRow> = {}): HourlyRow => ({
  id: nextId++,
  alarmTime: "2026-10-13 07:00:00",
  alarmNumber: "1",
  alarmText: "BCCH MISSING",
  alarmName: "BCCH MISSING",
  dn: "PLMN-PLMN/BSC-1/BCF-1",
  objectClass: "BTS",
  name: "S_BH-ONE_0001DE",
  siteName: "BH-ONE",
  code: "0001DE",
  office: "KAFR EL DAWAR",
  nodality: "1+2",
  vip: false,
  siteType: "SHELTER",
  powerSource: "EC",
  battery: "YES",
  phone: "",
  supplementaryInfo: "",
  region: "DE",
  technologies: ["2G"],
  sheet: "2G_Down",
  sheets: ["2G_Down"],
  category: "DOWN",
  clockInvalid: false,
  unmatched: false,
  ...over,
});
