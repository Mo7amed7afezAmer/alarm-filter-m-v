// "@alarm/core/hourly" — server entry: the full stateless pipeline (§14).
// attachment bytes → validate → extract (temp dir, always removed) → parse → enrich +
// normalize → { meta, rows }. Nothing is persisted.

import { enrichRows, siteMap, type SiteInfo } from "./enrich.js";
import { extractXlsx, type RarBackend } from "./extract.js";
import { compileNormalizer, type NormalizationRule } from "./normalize.js";
import { parseReport } from "./parse.js";
import type { HourlyMeta, HourlyRow } from "./types.js";
import { validateRar, type HourlyLimits } from "./validate.js";

export * from "./shared.js";
export * from "./validate.js";
export * from "./extract.js";
export * from "./parse.js";
export * from "./exportXlsx.js";
export * from "./siteMaster.js";

export interface ProcessedReport {
  meta: HourlyMeta;
  rows: HourlyRow[];
}

export interface ProcessInput {
  fileName: string;
  data: Buffer;
  sites: Iterable<SiteInfo>;
  normalizations: readonly NormalizationRule[];
  limits: HourlyLimits;
  backend?: RarBackend;
  tmpRoot?: string;
}

export async function processReport(input: ProcessInput): Promise<ProcessedReport> {
  const started = Date.now();
  validateRar(input.fileName, input.data, input.limits);
  const xlsx = await extractXlsx(input.data, {
    limits: input.limits,
    backend: input.backend,
    tmpRoot: input.tmpRoot,
  });
  const parsed = await parseReport(xlsx.data);
  const { rows, unmatchedCodes, emptyCodes } = enrichRows(
    parsed.rows,
    siteMap(input.sites),
    compileNormalizer(input.normalizations),
  );
  return {
    meta: {
      rowCount: rows.length,
      sheets: parsed.sheets,
      unmatchedCodes,
      emptyCodes,
      processedAt: new Date().toISOString(),
      durationMs: Date.now() - started,
    },
    rows,
  };
}
