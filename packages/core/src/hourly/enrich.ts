// SiteMaster join + normalization + category (§14). Pure, browser-safe.

import type { Normalizer } from "./normalize.js";
import type { RawHourlyRow } from "./parse.js";
import { hourlyCategory, regionOf, type HourlyRow } from "./types.js";

/** The SiteMaster columns used for enrichment. */
export interface SiteInfo {
  code: string;
  siteName?: string | null;
  office: string;
  nodality?: string | null;
  vip: boolean;
  siteType?: string | null;
  powerSource?: string | null;
  battery?: string | null;
}

export interface EnrichResult {
  rows: HourlyRow[];
  /** Distinct non-empty codes with no SiteMaster entry. */
  unmatchedCodes: number;
  /** Rows whose Site Code is empty. */
  emptyCodes: number;
}

export function enrichRows(
  raw: readonly RawHourlyRow[],
  sites: ReadonlyMap<string, SiteInfo>,
  normalize: Normalizer,
): EnrichResult {
  const unmatched = new Set<string>();
  let emptyCodes = 0;
  const rows = raw.map((r, id): HourlyRow => {
    const code = r.code.trim().toUpperCase();
    const site = code ? sites.get(code) : undefined;
    if (!code) emptyCodes++;
    else if (!site) unmatched.add(code);
    const alarmName = normalize("alarmName", r.alarmName);
    return {
      id,
      alarmTime: r.alarmTime,
      alarmNumber: r.alarmNumber,
      alarmText: normalize("alarmText", r.alarmText),
      alarmName,
      dn: r.dn,
      objectClass: r.objectClass,
      name: r.name,
      siteName: r.siteName,
      code,
      office: normalize("office", site?.office),
      nodality: normalize("nodality", site?.nodality),
      vip: site ? site.vip : null,
      siteType: normalize("siteType", site?.siteType),
      powerSource: normalize("powerSource", site?.powerSource),
      battery: normalize("battery", site?.battery),
      supplementaryInfo: normalize("supplementaryInfo", r.supplementaryInfo),
      region: regionOf(code),
      technologies: r.technologies,
      sheet: r.sheet,
      sheets: r.sheets,
      category: hourlyCategory(r.sheet, alarmName),
      clockInvalid: r.clockInvalid,
      unmatched: !site,
    };
  });
  return { rows, unmatchedCodes: unmatched.size, emptyCodes };
}

/** SiteMaster rows → lookup map keyed by upper-case code. */
export const siteMap = (sites: Iterable<SiteInfo>): Map<string, SiteInfo> =>
  new Map([...sites].map((s) => [s.code.trim().toUpperCase(), s]));
